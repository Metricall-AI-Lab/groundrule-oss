import { afterEach, describe, expect, it } from "vitest";
import {
  importInstructions,
  importOwners,
  importToolSettings,
  indexStandards,
  instructionFingerprint,
  type LoadedStandard,
  splitInstructions,
  type ToolMapping,
} from "../src/index.js";
import { tempRepo } from "./repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const AGENTS = `# Acme API — Agent Instructions

The API for Acme. Built with Fastify.

## Commands

- \`pnpm dev\` starts the server
- \`pnpm test\` runs tests

## Rules

- Never log request bodies, tokens, or personal data.
- Use the shared \`httpClient\` for outbound calls; do not add axios.
  It handles retries and tracing.
- Prefer small pull requests.
  - One concern per PR
  - Link the ticket
1. Validate all input with Zod.

Always run \`pnpm check\` before you finish.

\`\`\`ts
// never do this
console.log(req.body)
\`\`\`

| Tool | Use |
|------|-----|
| zod  | validation |

<!-- groundrule:begin -->
- **SEC-001** generated rule that must be ignored
<!-- groundrule:end -->

@AGENTS.md
`;

describe("splitInstructions", () => {
  it("keeps instructions, with their section and lines, and skips everything else", () => {
    const { items } = splitInstructions(AGENTS);
    expect(items.map((i) => [i.text, i.section, i.strength, i.startLine, i.endLine])).toEqual([
      ["Never log request bodies, tokens, or personal data.", "Rules", "must", 12, 12],
      [
        "Use the shared `httpClient` for outbound calls; do not add axios. It handles retries and tracing.",
        "Rules",
        "must",
        13,
        14,
      ],
      [
        "Prefer small pull requests — One concern per PR; Link the ticket",
        "Rules",
        "should",
        15,
        17,
      ],
      ["Validate all input with Zod.", "Rules", "should", 18, 18],
      ["Always run `pnpm check` before you finish.", "Rules", "must", 20, 20],
    ]);
  });

  it("turns Cursor globs and Copilot applyTo into a path scope", () => {
    const cursor = splitInstructions(
      "---\ndescription: tests\nglobs: src/**/*.test.ts\n---\n- Use fake timers in tests.\n",
    );
    expect(cursor.paths).toEqual(["src/**/*.test.ts"]);
    expect(cursor.items[0]).toMatchObject({ text: "Use fake timers in tests.", startLine: 5 });
    const copilot = splitInstructions(
      '---\napplyTo: "**/*.py,scripts/**"\n---\n- Type-annotate public functions.\n',
    );
    expect(copilot.paths).toEqual(["**/*.py", "scripts/**"]);
    expect(
      splitInstructions("---\napplyTo: '**'\n---\n- Be kind to reviewers please.\n").paths,
    ).toBeUndefined();
  });

  it("fingerprints by meaning, not formatting", () => {
    expect(instructionFingerprint("Never log **tokens**.")).toBe(
      instructionFingerprint("never log `tokens`"),
    );
    expect(instructionFingerprint("Never log tokens")).not.toBe(
      instructionFingerprint("Always log tokens"),
    );
  });
});

const standard = (id: string, title: string, requirement: string): LoadedStandard =>
  ({
    file: `/catalog/${id}.yaml`,
    origin: "groundrule:packs/test",
    disabled: false,
    standard: {
      apiVersion: "groundrule.dev/v1alpha1",
      kind: "Standard",
      metadata: { id, title, type: "requirement", version: 1, status: "active" },
      spec: {
        severity: "warning",
        requirement,
        agent: { instruction: true },
        scope: {},
        checks: [],
      },
    },
  }) as unknown as LoadedStandard;

describe("matching the catalog", () => {
  const index = indexStandards([
    standard(
      "SEC-006",
      "Never log secrets or personal data",
      "Never log secrets, tokens, cookies, request bodies, or personal data.",
    ),
    standard(
      "TS-001",
      "No console.log in application code",
      "Use the project's logger instead of console.log.",
    ),
    standard(
      "TEST-005",
      "Wait for conditions, not fixed sleeps, in tests",
      "Do not use fixed sleeps in tests.",
    ),
  ]);

  it("finds catalog rules with similar wording", () => {
    expect(index.match("Never log request bodies, tokens, or personal data.")[0]?.id).toBe(
      "SEC-006",
    );
    expect(index.match("Don't leave console.log calls in app code")[0]?.id).toBe("TS-001");
  });

  it("stays quiet when nothing is similar", () => {
    expect(index.match("Non-members get 404 for an organization, never 403.")).toEqual([]);
  });
});

describe("importing from a repository", () => {
  it("merges the same instruction across agent files and redacts text", async () => {
    const repo = await tempRepo({
      "AGENTS.md": "## Rules\n- Never log tokens.\n- Use the key AKIA_PLACEHOLDER only in tests.\n",
      "CLAUDE.md": "@AGENTS.md\n\n# Claude\n- never log `tokens`\n",
    });
    cleanups.push(repo.cleanup);
    const files = [
      { path: "AGENTS.md", kind: "agents-md" as const },
      { path: "CLAUDE.md", kind: "claude-md" as const },
    ].map((f) => ({
      ...f,
      lines: 1,
      bytes: 1,
      sha256: "0".repeat(64),
      managed: false,
      headings: 1,
      bullets: 1,
    }));
    const found = await importInstructions(repo.root, files, indexStandards([]), (t) =>
      t.replace("AKIA_PLACEHOLDER", "[redacted]"),
    );
    expect(found).toHaveLength(2);
    expect(found[0]?.sources).toEqual([
      { file: "AGENTS.md", startLine: 2, endLine: 2 },
      { file: "CLAUDE.md", startLine: 4, endLine: 4 },
    ]);
    expect(found[1]?.text).toBe("Use the key [redacted] only in tests.");
  });

  it("maps linter and compiler settings to catalog rules, without running configs", async () => {
    const mapping: ToolMapping = {
      eslint: {
        "no-console": "TS-001",
        "@typescript-eslint/no-explicit-any": "TS-005",
        "no-debugger": "TS-014",
      },
      biome: { noArrayIndexKey: "REACT-002", noDebugger: "TS-014" },
      ruff: { T201: "PY-003", E722: "PY-001", S101: "PY-012", F403: "PY-008" },
      golangci: { errcheck: "GO-001", noctx: "GO-006" },
      checkstyle: { IllegalCatch: "JAVA-016" },
      pmd: { SystemPrintln: "JAVA-002" },
      tsconfig: { strict: "TS-007" },
    };
    const repo = await tempRepo({
      "eslint.config.mjs": `import ts from "typescript-eslint";\nprocess.exit(1);\nexport default [{ rules: {\n  "no-console": "error",\n  '@typescript-eslint/no-explicit-any': ["warn"],\n  "no-debugger": 0,\n  "some-unknown-rule": "error",\n} }];\n`,
      "web/biome.json":
        '{ "linter": { "rules": { "suspicious": { "noArrayIndexKey": { "level": "error" } } } } }',
      "pyproject.toml":
        '[project]\nname = "x"\nselect = ["ALL"]\n\n[tool.ruff.lint]\nselect = ["E", "F", "T20"]\nignore = ["E722"]\n\n[tool.black]\nline-length = 100\n',
      ".golangci.yml": "linters:\n  enable:\n    - errcheck\n  disable:\n    - noctx\n",
      "config/checkstyle.xml":
        '<module name="Checker"><module name="TreeWalker"><module name="IllegalCatch"/></module></module>',
      "tsconfig.json": '{\n  // strict on\n  "compilerOptions": { "strict": false }\n}\n',
      "node_modules/x/.eslintrc.json": '{ "rules": { "no-console": "off" } }',
    });
    cleanups.push(repo.cleanup);
    const settings = await importToolSettings(
      repo.root,
      repo.git("ls-files").trim().split("\n"),
      mapping,
    );
    const rows = settings.map((s) => [s.tool, s.setting, s.stance, s.standardId, s.source.line]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["eslint", "no-console", "enforced", "TS-001", 4],
        ["eslint", "@typescript-eslint/no-explicit-any", "warned", "TS-005", 5],
        ["eslint", "no-debugger", "disabled", "TS-014", 6],
        ["biome", "noArrayIndexKey", "enforced", "REACT-002", 1],
        ["ruff", "T201", "enforced", "PY-003", 6],
        ["ruff", "E722", "disabled", "PY-001", 7],
        ["ruff", "F403", "enforced", "PY-008", 6],
        ["golangci-lint", "errcheck", "enforced", "GO-001", 3],
        ["golangci-lint", "noctx", "disabled", "GO-006", 5],
        ["checkstyle", "IllegalCatch", "enforced", "JAVA-016", 1],
        ["typescript", "strict", "disabled", "TS-007", 3],
      ]),
    );
    // Only Ruff's own section counts, and S101 was never selected.
    expect(rows.find((r) => r[1] === "S101")).toBeUndefined();
    expect(rows).toHaveLength(11);
  });

  it("reads CODEOWNERS into owner suggestions by category", async () => {
    const repo = await tempRepo({
      ".github/CODEOWNERS": [
        "# Owners",
        "*                       @acme/platform",
        "/.github/workflows/     @acme/devex @lee",
        "/infra/                 @acme/sre",
        "src/auth/**             @acme/security sec@acme.com",
        "*.test.ts               @acme/qa",
        "docs/                   # nobody",
        "[Section]",
        "/api/                   @acme/api-team",
      ].join("\n"),
    });
    cleanups.push(repo.cleanup);
    const owners = await importOwners(repo.root, [".github/CODEOWNERS"]);
    expect(
      owners.map((o) => [o.pattern, o.owners, o.category, o.repositoryDefault, o.source.startLine]),
    ).toEqual([
      ["*", ["@acme/platform"], undefined, true, 2],
      ["/.github/workflows/", ["@acme/devex", "@lee"], "ci", false, 3],
      ["/infra/", ["@acme/sre"], "infrastructure", false, 4],
      ["src/auth/**", ["@acme/security", "sec@acme.com"], "security", false, 5],
      ["*.test.ts", ["@acme/qa"], "testing", false, 6],
      ["/api/", ["@acme/api-team"], "api-design", false, 9],
    ]);
  });
});
