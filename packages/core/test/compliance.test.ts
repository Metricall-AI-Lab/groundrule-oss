// The compliance record (RFC 0007): digests are stable and change with any rule change, and
// coding agents are counted from commit metadata only.
import { Standard } from "@groundrule/spec";
import { describe, expect, it } from "vitest";
import {
  agentsOf,
  appliedStandard,
  canonicalJson,
  detectAgents,
  gitAuthorship,
  type LoadedStandard,
  rulebookDigest,
  ruleDigest,
  rulesInEffect,
} from "../src/index.js";
import { tempRepo } from "./repo.js";

const doc = (id: string, requirement = `Rule ${id}.`, severity = "blocker") =>
  Standard.parse({
    apiVersion: "groundrule.dev/v1alpha1",
    kind: "Standard",
    metadata: { id, title: `${id} title`, type: "requirement" },
    spec: { severity, requirement, checks: [{ evaluator: "regex", pattern: "x" }] },
  });

const loaded = (standard: Standard, extra: Partial<LoadedStandard> = {}): LoadedStandard => ({
  standard,
  file: `/rules/${standard.metadata.id}.yaml`,
  origin: "local",
  disabled: false,
  ...extra,
});

describe("digests", () => {
  it("are canonical: key order doesn't matter, content does", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
    const a = doc("PAY-001");
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as Standard;
    expect(ruleDigest(reordered)).toBe(ruleDigest(a));
    expect(ruleDigest(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ruleDigest(doc("PAY-001", "Other wording."))).not.toBe(ruleDigest(a));
    expect(ruleDigest(doc("PAY-001", undefined, "warning"))).not.toBe(ruleDigest(a));
  });

  it("keep a rule's digest when Advise lowers its severity; the stage says so", () => {
    const set = doc("PAY-001");
    const lowered = loaded(
      { ...set, spec: { ...set.spec, severity: "warning" } },
      { stage: "advise", originalSeverity: "blocker" },
    );
    expect(appliedStandard(lowered)).toEqual(set);
    // A config override is a customization: it stays in the digest.
    const overridden = loaded(lowered.standard, { originalSeverity: "blocker" });
    expect(appliedStandard(overridden).spec.severity).toBe("warning");
  });

  it("cover every rule in effect, in any order, and change with any stage or rule", () => {
    const rules = [
      loaded(doc("B-001"), { stage: "enforce" }),
      loaded(doc("A-001"), { stage: "teach" }),
      loaded(doc("C-001"), { stage: "observe" }),
      loaded(doc("D-001"), { disabled: true }),
      loaded({ ...doc("E-001"), metadata: { ...doc("E-001").metadata, status: "draft" } }),
      loaded(doc("F-001")),
    ];
    const inEffect = rulesInEffect(rules);
    // Teach counts; Observe, turned off and drafts don't.
    expect(inEffect.map((r) => r.id).sort()).toEqual(["A-001", "B-001", "F-001"]);
    const digest = rulebookDigest(inEffect);
    expect(rulebookDigest([...inEffect].reverse())).toBe(digest);
    expect(
      rulebookDigest(inEffect.map((r) => (r.id === "A-001" ? { ...r, stage: "advise" } : r))),
    ).not.toBe(digest);
    expect(
      rulebookDigest(rulesInEffect([...rules.slice(1), loaded(doc("B-001", "Changed."))])),
    ).not.toBe(digest);
  });
});

const commit = (authorName: string, authorEmail: string, message = "Change\n") => ({
  authorName,
  authorEmail,
  message,
});

describe("agents declared by commits", () => {
  it("recognizes each first marker", () => {
    expect(
      agentsOf(
        commit("Ana", "ana@acme.dev", "Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"),
      ),
    ).toEqual(["Claude Code"]);
    expect(
      agentsOf(
        commit(
          "Ana",
          "ana@acme.dev",
          "Fix\n\n🤖 Generated with [Claude Code](https://claude.com)\n",
        ),
      ),
    ).toEqual(["Claude Code"]);
    expect(
      agentsOf(
        commit("Ana", "ana@acme.dev", "Fix\n\nCo-authored-by: Cursor <cursoragent@cursor.com>"),
      ),
    ).toEqual(["Cursor"]);
    expect(
      agentsOf(commit("Copilot", "198982749+Copilot@users.noreply.github.com", "Initial plan")),
    ).toEqual(["GitHub Copilot"]);
    expect(agentsOf(commit("Codex", "codex@openai.com"))).toEqual(["Codex"]);
    expect(
      agentsOf(
        commit("Ana", "ana@acme.dev", "Fix\n\nCo-authored-by: aider (gpt-4o) <aider@aider.chat>"),
      ),
    ).toEqual(["Aider"]);
    expect(agentsOf(commit("Ana (aider)", "ana@acme.dev"))).toEqual(["Aider"]);
  });

  it("doesn't guess: people, look-alikes and mentions in prose aren't agents", () => {
    expect(agentsOf(commit("Claude Monet", "claude@acme.dev"))).toEqual([]);
    expect(agentsOf(commit("Ana", "ana@acme.dev", "Ask Cursor about this later"))).toEqual([]);
    expect(agentsOf(commit("copilot-fan", "fan@acme.dev"))).toEqual([]);
  });

  it("counts commits per agent, most first, and every commit in the change", () => {
    const claude = "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
    expect(
      detectAgents([
        commit("Ana", "a@a", claude),
        commit("Ana", "a@a", `${claude}\nCo-authored-by: Cursor <cursoragent@cursor.com>`),
        commit("Ana", "a@a"),
      ]),
    ).toEqual({
      commits: 3,
      agents: [
        { name: "Claude Code", commits: 2 },
        { name: "Cursor", commits: 1 },
      ],
      method: "commit-metadata",
    });
  });

  it("reads base..HEAD from git, and gives up without the base", async () => {
    const repo = await tempRepo({ "a.txt": "a\n" });
    try {
      repo.git("switch", "-q", "-c", "feature");
      await repo.write("a.txt", "b\n");
      repo.git("commit", "-qam", "Change\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
      await repo.write("a.txt", "c\n");
      repo.git("commit", "-qam", "By hand");
      expect(await gitAuthorship(repo.root, "main")).toEqual({
        commits: 2,
        agents: [{ name: "Claude Code", commits: 1 }],
        method: "commit-metadata",
      });
      expect(await gitAuthorship(repo.root, "no-such-base")).toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });
});
