import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineEvaluator,
  type Evaluator,
  type EvaluatorFinding,
  loadWorkspace,
  runChecks,
} from "../src/index.js";
import { CONFIG, standardYaml, tempRepo } from "./repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** Reports a violation on every line containing "BAD" in target files. */
const badWord = defineEvaluator({
  id: "bad-word",
  source: "deterministic",
  description: "test",
  optionsSchema: z.strictObject({
    confidence: z.enum(["low", "medium", "high", "certain"]).default("certain"),
  }),
  async evaluate({ options, context }) {
    const out: EvaluatorFinding[] = [];
    for (const file of context.targetFiles) {
      const lines = (await context.readFile(file)).split("\n");
      lines.forEach((line, i) => {
        if (line.includes("BAD")) {
          out.push({
            status: "violation",
            confidence: options.confidence,
            message: "bad",
            location: { file, startLine: i + 1 },
            snippet: line,
          });
        }
      });
    }
    return out;
  },
});

const exploding = defineEvaluator({
  id: "exploding",
  source: "deterministic",
  description: "test",
  optionsSchema: z.object({}),
  async evaluate(): Promise<EvaluatorFinding[]> {
    throw new Error("kaboom");
  },
});

const unavailable = defineEvaluator({
  id: "unavailable",
  source: "external",
  description: "test",
  optionsSchema: z.object({}),
  supports: () => "Install the tool",
  async evaluate() {
    return [];
  },
});

const evaluators = [badWord, exploding, unavailable] as Evaluator<unknown>[];

const std = (id: string, severity: string, checks: string, extra = "") =>
  standardYaml(id, `  severity: ${severity}\n  requirement: No BAD.\n  checks:\n${checks}${extra}`);

async function setup(files: Record<string, string>, config = "") {
  const r = await tempRepo({ ".groundrule/config.yaml": CONFIG(config), ...files });
  cleanups.push(r.cleanup);
  const load = async () => {
    const result = await loadWorkspace({ cwd: r.root });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.workspace;
  };
  return { ...r, load };
}

describe("runChecks", () => {
  it("audits everything in all mode and fails on blockers", async () => {
    const r = await setup({
      ".groundrule/standards/B-1.yaml": std("B-1", "blocker", "    - evaluator: bad-word\n"),
      "src/a.ts": "ok\nBAD\n",
    });
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(result.failed).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      standardId: "B-1",
      evaluator: "bad-word",
      source: "deterministic",
      severity: "blocker",
      isNew: true,
      location: { file: "src/a.ts", startLine: 2 },
    });
    expect(result.outcomes[0]?.status).toBe("failed");
  });

  it("separates new findings from legacy ones in changes mode", async () => {
    const r = await setup({
      ".groundrule/standards/B-1.yaml": std("B-1", "blocker", "    - evaluator: bad-word\n"),
      "src/a.ts": "BAD old\nok\n",
    });
    await r.write("src/a.ts", "BAD old\nBAD new\n");
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "changes" });
    expect(result.findings.map((f) => [f.location?.startLine, f.isNew])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(result.summary).toMatchObject({ blocking: 1, legacy: 1 });
  });

  it("a standard with only legacy findings counts as passed in changes mode", async () => {
    const r = await setup({
      ".groundrule/standards/W-1.yaml": std("W-1", "warning", "    - evaluator: bad-word\n"),
      "src/a.ts": "BAD old\nok\n",
    });
    await r.write("src/a.ts", "BAD old\nfine\n");
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "changes" });
    expect(result.outcomes[0]?.status).toBe("passed");
    expect(result.summary).toMatchObject({ warned: 0, legacy: 1 });
  });

  it("legacy: ignore drops old findings; legacy: enforce fails on them", async () => {
    const files = {
      ".groundrule/standards/B-1.yaml": std("B-1", "blocker", "    - evaluator: bad-word\n"),
      "src/a.ts": "BAD old\n",
      "src/b.ts": "x\n",
    };
    const ignore = await setup(files, "enforcement:\n  legacy: ignore");
    await ignore.write("src/a.ts", "BAD old\nfine\n");
    expect((await runChecks({ workspace: await ignore.load(), evaluators })).findings).toEqual([]);

    const enforce = await setup(files, "enforcement:\n  legacy: enforce");
    await enforce.write("src/a.ts", "BAD old\nfine\n");
    const result = await runChecks({ workspace: await enforce.load(), evaluators });
    expect(result.failed).toBe(true);
  });

  it("only fails at or above failOn", async () => {
    const r = await setup(
      {
        ".groundrule/standards/W-1.yaml": std("W-1", "warning", "    - evaluator: bad-word\n"),
        "a.ts": "BAD\n",
      },
      "enforcement:\n  failOn: blocker",
    );
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(result.failed).toBe(false);
    expect(result.outcomes[0]?.status).toBe("warned");
  });

  it("downgrades low-confidence violations to concerns, which never fail", async () => {
    const r = await setup({
      ".groundrule/standards/B-1.yaml": std(
        "B-1",
        "blocker",
        "    - evaluator: bad-word\n      confidence: medium\n      minConfidence: high\n",
      ),
      "a.ts": "BAD\n",
    });
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(result.findings[0]?.status).toBe("concern");
    expect(result.failed).toBe(false);
  });

  it("applies active exceptions by path", async () => {
    const r = await setup({
      ".groundrule/standards/B-1.yaml": std("B-1", "blocker", "    - evaluator: bad-word\n"),
      ".groundrule/exceptions.yaml":
        'apiVersion: groundrule.dev/v1alpha1\nkind: ExceptionList\nspec:\n  exceptions:\n    - id: EX-7\n      standard: B-1\n      paths: ["legacy/**"]\n      reason: r\n      expires: "2999-01-01"\n',
      "legacy/a.ts": "BAD\n",
      "src/a.ts": "BAD\n",
    });
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(result.findings.map((f) => [f.location?.file, f.suppressedBy])).toEqual([
      ["src/a.ts", undefined],
      ["legacy/a.ts", "EX-7"],
    ]);
    expect(result.summary).toMatchObject({ blocking: 1, suppressed: 1 });
  });

  it("restricts content checks to the standard's paths", async () => {
    const r = await setup({
      ".groundrule/standards/B-1.yaml": std(
        "B-1",
        "blocker",
        "    - evaluator: bad-word\n",
        "\n  scope:\n    paths: ['src/**']\n    exclude: ['src/gen/**']",
      ),
      "src/a.ts": "BAD\n",
      "src/gen/a.ts": "BAD\n",
      "test/a.ts": "BAD\n",
    });
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(result.findings.map((f) => f.location?.file)).toEqual(["src/a.ts"]);
  });

  it("skips standards for languages or tags the repository does not have", async () => {
    const r = await setup(
      {
        ".groundrule/standards/J-1.yaml": std(
          "J-1",
          "blocker",
          "    - evaluator: bad-word\n",
          "\n  scope:\n    languages: [java]",
        ),
        ".groundrule/standards/T-1.yaml": std(
          "T-1",
          "blocker",
          "    - evaluator: bad-word\n",
          "\n  scope:\n    tags: [backend]",
        ),
        "a.ts": "BAD\n",
      },
      "tags: [backend]",
    );
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(result.outcomes.map((o) => [o.id, o.status, o.reason])).toEqual([
      ["J-1", "skipped", "Not applicable: language java not found."],
      ["T-1", "failed", undefined],
    ]);
  });

  it("reports guidance-only, disabled, unavailable, failing, and misconfigured checks", async () => {
    const r = await setup(
      {
        ".groundrule/standards/G-1.yaml": standardYaml(
          "G-1",
          "  severity: warning\n  requirement: Be nice.",
        ),
        ".groundrule/standards/D-1.yaml": std("D-1", "blocker", "    - evaluator: bad-word\n"),
        ".groundrule/standards/U-1.yaml": std("U-1", "blocker", "    - evaluator: unavailable\n"),
        ".groundrule/standards/E-1.yaml": std("E-1", "blocker", "    - evaluator: exploding\n"),
        ".groundrule/standards/M-1.yaml": std(
          "M-1",
          "blocker",
          "    - evaluator: bad-word\n      confidence: sure\n    - evaluator: nope\n",
        ),
        "a.ts": "ok\n",
      },
      "overrides:\n  D-1:\n    disabled: true\n    reason: Too noisy",
    );
    const result = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(Object.fromEntries(result.outcomes.map((o) => [o.id, [o.status, o.reason]]))).toEqual({
      "D-1": ["skipped", "Disabled by config override: Too noisy"],
      "E-1": ["not-evaluable", "exploding failed: kaboom."],
      "G-1": ["guidance", "Guidance for agents and reviewers; no automated check."],
      "M-1": ["not-evaluable", 'Invalid bad-word options. Unknown evaluator "nope".'],
      "U-1": ["not-evaluable", "Install the tool."],
    });
    expect(result.diagnostics.map((d) => [d.path, d.severity])).toEqual([
      ["spec.checks[0]", "warning"],
      ["spec.checks[0].confidence", "error"],
      ["spec.checks[1].evaluator", "error"],
    ]);
    expect(result.failed).toBe(false);
  });

  it("gives findings stable fingerprints across runs and line shifts", async () => {
    const r = await setup({
      ".groundrule/standards/B-1.yaml": std("B-1", "blocker", "    - evaluator: bad-word\n"),
      "a.ts": "BAD thing\n",
    });
    const first = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    await r.write("a.ts", "\n\nBAD thing\n");
    const second = await runChecks({ workspace: await r.load(), evaluators, mode: "all" });
    expect(second.findings[0]?.fingerprint).toBe(first.findings[0]?.fingerprint);
    expect(second.findings[0]?.location?.startLine).toBe(3);
  });

  it("runs only selected standards", async () => {
    const r = await setup({
      ".groundrule/standards/A-1.yaml": std("A-1", "blocker", "    - evaluator: bad-word\n"),
      ".groundrule/standards/B-1.yaml": std("B-1", "blocker", "    - evaluator: bad-word\n"),
      "a.ts": "BAD\n",
    });
    const result = await runChecks({
      workspace: await r.load(),
      evaluators,
      mode: "all",
      only: ["B-1"],
    });
    expect(result.outcomes.map((o) => o.id)).toEqual(["B-1"]);
  });
});
