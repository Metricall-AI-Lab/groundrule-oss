import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScanReport } from "@groundrule/spec";
import picomatch from "picomatch";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineEvaluator,
  detectAgentFiles,
  detectTools,
  type EvaluatorFinding,
  type LoadedStandard,
  loadFile,
  redactSecrets,
  scanRepository,
} from "../src/index.js";
import { standardYaml, tempRepo } from "./repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** Flags lines containing "BAD" in files matching `include`. */
const badWord = defineEvaluator({
  id: "bad-word",
  source: "deterministic",
  description: "test",
  optionsSchema: z.strictObject({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  }),
  async evaluate({ options, context }) {
    const inc = options.include ? picomatch(options.include) : () => true;
    const out: EvaluatorFinding[] = [];
    for (const file of context.targetFiles.filter((f) => inc(f))) {
      (await context.readFile(file)).split("\n").forEach((line, i) => {
        if (line.includes("BAD"))
          out.push({
            status: "violation",
            confidence: "certain",
            message: "bad word",
            location: { file, startLine: i + 1 },
          });
      });
    }
    return out;
  },
});

async function standards(defs: Record<string, string>): Promise<LoadedStandard[]> {
  const dir = await mkdtemp(join(tmpdir(), "groundrule-scan-std-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const out: LoadedStandard[] = [];
  for (const [id, yaml] of Object.entries(defs)) {
    const file = join(dir, `${id}.yaml`);
    await writeFile(file, yaml);
    const result = await loadFile(file, "Standard");
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    out.push({ standard: result.document, file, origin: "groundrule:packs/test", disabled: false });
  }
  return out;
}

const check = (include?: string) =>
  `  severity: warning\n  requirement: No BAD.\n  checks:\n    - evaluator: bad-word\n${include ? `      include: ["${include}"]\n` : ""}`;

// Secret-shaped values are assembled at runtime so none is ever committed.
const AWS_KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
const JWT = ["eyJhbGciOiJIUzI1", "eyJzdWIiOiIxMjM0", "SflKxwRJSMeKKF2QT4"].join(".");

describe("redactSecrets", () => {
  it.each([
    [`const key = "${AWS_KEY}";`, 'const key = "[redacted]";'],
    ['password: "correct-horse"', 'password: "[redacted]"'],
    ["API_TOKEN='abc123xyz'", "API_TOKEN='[redacted]'"],
    ["url = postgres://user:pa55word@db:5432/app", "url = postgres://[redacted]@db:5432/app"],
    [`Authorization: Bearer ${JWT}`, "Authorization: Bearer [redacted]"],
    ["const x = 'Zx9pQ2mL7vR4tY8wN1bK6cJ3hF5gD0sA'", "const x = '[redacted]'"],
  ])("masks %s", (input, output) => {
    expect(redactSecrets(input)).toBe(output);
  });

  it("leaves ordinary code alone", () => {
    for (const line of [
      'console.log("user signed in", userId);',
      "export const ROUTES_PREFIX_FOR_ADMIN_DASHBOARD_PAGES = 1;",
      "import { readFile } from 'node:fs/promises';",
    ])
      expect(redactSecrets(line)).toBe(line);
  });
});

describe("agent files and tools", () => {
  it("finds instruction files for every agent, with structure but not content", async () => {
    const repo = await tempRepo({
      "AGENTS.md": "# Rules\n\n- one\n- two\n<!-- groundrule:begin -->\n<!-- groundrule:end -->\n",
      "services/api/AGENTS.md": "# API\n",
      "CLAUDE.md": "@AGENTS.md\n",
      ".cursor/rules/style.mdc": "Use tabs\n",
      ".cursorrules": "legacy\n",
      ".github/copilot-instructions.md": "# Copilot\n1. one\n",
      ".github/instructions/tests.instructions.md": "tests\n",
      "GEMINI.md": "g\n",
      ".windsurfrules": "w\n",
      "CONVENTIONS.md": "c\n",
      "node_modules/pkg/AGENTS.md": "ignored\n",
      "docs/README.md": "not an agent file\n",
    });
    cleanups.push(repo.cleanup);
    const files = repo.git("ls-files").trim().split("\n");
    const found = await detectAgentFiles(repo.root, files);
    expect(found.map((f) => [f.path, f.kind])).toEqual([
      [".cursor/rules/style.mdc", "cursor-rules"],
      [".cursorrules", "cursorrules"],
      [".github/copilot-instructions.md", "copilot-instructions"],
      [".github/instructions/tests.instructions.md", "copilot-path-instructions"],
      [".windsurfrules", "windsurf-rules"],
      ["AGENTS.md", "agents-md"],
      ["CLAUDE.md", "claude-md"],
      ["CONVENTIONS.md", "aider-conventions"],
      ["GEMINI.md", "gemini-md"],
      ["services/api/AGENTS.md", "agents-md"],
    ]);
    expect(found.find((f) => f.path === "AGENTS.md")).toMatchObject({
      managed: true,
      headings: 1,
      bullets: 2,
      lines: 7,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(found)).not.toContain("Use tabs");
  });

  it("recognizes tool configurations and a few facts", async () => {
    const repo = await tempRepo({
      "tsconfig.json": '{\n  // comment\n  "compilerOptions": { "strict": true, },\n}\n',
      "packages/a/tsconfig.json": "{}",
      "pyproject.toml": "[project]\nname='x'\n\n[tool.ruff]\nline-length = 100\n",
      ".github/CODEOWNERS": "# owners\n* @acme/platform\n/api @acme/api\n",
      ".github/workflows/ci.yml": "on: push\n",
      ".github/workflows/release.yml": "on: push\n",
      "eslint.config.mjs": "export default []\n",
      Dockerfile: "FROM node:22\n",
    });
    cleanups.push(repo.cleanup);
    const tools = await detectTools(repo.root, repo.git("ls-files").trim().split("\n"));
    const byId = Object.fromEntries(tools.map((t) => [t.id, t]));
    expect(Object.keys(byId).sort()).toEqual([
      "codeowners",
      "docker",
      "eslint",
      "github-actions",
      "ruff",
      "typescript",
    ]);
    expect(byId.typescript?.facts).toMatchObject({ strict: true, files: 2 });
    expect(byId.codeowners?.facts).toEqual({ rules: 2 });
    expect(byId["github-actions"]?.facts).toEqual({ files: 2 });
    expect(byId.black).toBeUndefined();
  });
});

describe("scanRepository", () => {
  it("observes every rule, counts what each one checks, and stays a valid report", async () => {
    const repo = await tempRepo({
      "src/a.ts": 'const ok = 1;\nconst BAD = 2; // password: "hunter2-secret"\n',
      "src/b.ts": "BAD\n",
      "src/c.ts": "fine\n",
      "README.md": "BAD in docs is out of scope\n",
    });
    cleanups.push(repo.cleanup);
    const report = await scanRepository({
      root: repo.root,
      standards: await standards({
        "TST-001": standardYaml("TST-001", check("src/**/*.ts")),
        "TST-002": standardYaml("TST-002", check("**/Dockerfile")),
        "TST-003": standardYaml("TST-003", "  severity: info\n  requirement: Just guidance.\n"),
        "TST-004": standardYaml("TST-004", `${check()}  scope:\n    languages: [python]\n`),
        "SEC-099": standardYaml("SEC-099", check("src/**/*.ts"), "  category: security"),
      }),
      evaluators: [badWord],
      cliVersion: "9.9.9",
      snippets: true,
      repositoryName: "acme/demo",
    });

    expect(ScanReport.safeParse(report).success).toBe(true);
    expect(report.repository).toMatchObject({ name: "acme/demo", branch: "main", files: 4 });
    expect(report.repository.commit).toMatch(/^[0-9a-f]{40}$/);
    const rule = (id: string) => report.rules.find((r) => r.id === id);

    expect(rule("TST-001")).toMatchObject({
      outcome: "violations",
      findings: 2,
      filesInScope: 3,
      filesAffected: 2,
    });
    expect(rule("TST-001")?.examples[0]).toEqual({
      file: "src/a.ts",
      line: 2,
      message: "bad word",
      snippet: 'const BAD = 2; // password: "[redacted]"',
    });
    // No Dockerfile: nothing to check is not the same as passing.
    expect(rule("TST-002")).toMatchObject({ outcome: "not-applicable", filesInScope: 0 });
    expect(rule("TST-003")?.outcome).toBe("guidance");
    expect(rule("TST-004")?.outcome).toBe("not-applicable");
    // Security rules never carry code.
    expect(rule("SEC-099")?.examples.every((e) => e.snippet === undefined)).toBe(true);
    expect(report.summary).toMatchObject({
      rules: 5,
      violations: 2,
      guidance: 1,
      notApplicable: 2,
      findings: 4,
    });
  });

  it("leaves snippets out when asked", async () => {
    const repo = await tempRepo({ "src/a.ts": "BAD\n" });
    cleanups.push(repo.cleanup);
    const report = await scanRepository({
      root: repo.root,
      standards: await standards({ "TST-001": standardYaml("TST-001", check()) }),
      evaluators: [badWord],
      cliVersion: "1.0.0",
      snippets: false,
    });
    expect(report.metadata.snippets).toBe(false);
    expect(report.rules[0]?.examples).toEqual([{ file: "src/a.ts", line: 1, message: "bad word" }]);
  });
});
