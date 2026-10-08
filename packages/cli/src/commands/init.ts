import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  detectLanguages,
  exists,
  gitRoot,
  listGitFiles,
  walkFiles,
} from "@groundrule/core";
import { AGENT_TARGETS, type AgentTarget } from "@groundrule/spec";
import { EXIT, eprintln, type IO, println, style } from "../io.js";

export interface InitOptions {
  targets?: AgentTarget[];
  packs?: string[];
  force?: boolean;
}

const TARGET_FILES: Record<AgentTarget, string[]> = {
  "agents-md": ["AGENTS.md"],
  "claude-code": ["CLAUDE.md", ".claude"],
  cursor: [".cursor", ".cursorrules"],
  copilot: [".github/copilot-instructions.md", ".github/instructions"],
};

const TARGET_OUTPUT: Record<AgentTarget, string> = {
  "agents-md": "AGENTS.md",
  "claude-code": "CLAUDE.md",
  cursor: ".cursor/rules/",
  copilot: ".github/copilot-instructions.md",
};

export async function init(io: IO, options: InitOptions): Promise<number> {
  const s = style(io);
  const root = (await gitRoot(io.cwd)) ?? io.cwd;
  const configFile = join(root, CONFIG_DIR, CONFIG_FILE);
  if ((await exists(configFile)) && !options.force) {
    eprintln(io, `✕ ${CONFIG_DIR}/${CONFIG_FILE} already exists. Use --force to overwrite it.`);
    return EXIT.usage;
  }

  const files = (await gitRoot(root)) ? await listGitFiles(root) : await walkFiles(root);
  const languages = detectLanguages(files);

  // Deliver to the agents this team already uses; AGENTS.md is the cross-tool default.
  const detected = (
    await Promise.all(
      AGENT_TARGETS.map(async (t) =>
        (await Promise.all(TARGET_FILES[t].map((f) => exists(join(root, f))))).some(Boolean)
          ? t
          : undefined,
      ),
    )
  ).filter((t): t is AgentTarget => t !== undefined);
  const targets = options.targets ?? [
    ...new Set<AgentTarget>([
      "agents-md",
      ...detected,
      ...(detected.length ? [] : ["claude-code" as const]),
    ]),
  ];

  const packs = options.packs ?? [
    "security-baseline",
    ...(languages.some((l) => l === "typescript" || l === "javascript") ? ["typescript-node"] : []),
    ...(languages.includes("java") ? ["java-spring"] : []),
  ];

  const config = [
    "# yaml-language-server: $schema=https://groundrule.dev/schemas/v1alpha1/config.schema.json",
    "apiVersion: groundrule.dev/v1alpha1",
    "kind: Config",
    "",
    "# Shared standards this repository inherits. Add your organization's pack, e.g.",
    "#   - github:your-org/engineering-standards//packs/backend@v1",
    "extends:",
    ...packs.map((p) => `  - groundrule:packs/${p}`),
    "",
    "# Tags that standards can target with scope.tags, e.g. backend, multi-tenant.",
    "tags: []",
    "",
    "# Coding-agent instruction files that `groundrule sync` keeps up to date.",
    "targets:",
    ...targets.map((t) => `  - ${t}`),
    "",
    "enforcement:",
    "  scope: changed-lines   # check what a change touches: changed-lines | changed-files | all",
    "  legacy: report         # existing violations: report | ignore | enforce",
    "  failOn: blocker        # lowest severity that fails a check: blocker | warning | none",
    "",
  ].join("\n");

  await mkdir(join(root, CONFIG_DIR, "standards"), { recursive: true });
  await writeFile(configFile, config);
  const example = join(root, CONFIG_DIR, "standards", "EXAMPLE-001.yaml.sample");
  if (!(await exists(example))) await writeFile(example, EXAMPLE_STANDARD);

  println(io);
  println(io, ` ${s.green("✓")} Created ${s.bold(`${CONFIG_DIR}/${CONFIG_FILE}`)}`);
  println(io, `   ${s.dim("Packs")}    ${packs.join(", ") || "none"}`);
  println(io, `   ${s.dim("Agents")}   ${targets.map((t) => TARGET_OUTPUT[t]).join(", ")}`);
  if (languages.length) println(io, `   ${s.dim("Detected")} ${languages.slice(0, 4).join(", ")}`);
  println(io);
  println(io, ` ${s.bold("Next")}`);
  println(io, `   1. ${s.bold("groundrule sync")}     write instructions for your coding agents`);
  println(io, `   2. ${s.bold("groundrule check")}    check your current changes`);
  println(
    io,
    `   3. Add your own rules in ${CONFIG_DIR}/standards/ ${s.dim("(see EXAMPLE-001.yaml.sample)")}`,
  );
  println(io);
  return EXIT.ok;
}

const EXAMPLE_STANDARD = `# Rename to EXAMPLE-001.yaml (and change the ID) to activate.
# yaml-language-server: $schema=https://groundrule.dev/schemas/v1alpha1/standard.schema.json
apiVersion: groundrule.dev/v1alpha1
kind: Standard
metadata:
  id: EXAMPLE-001
  title: Use the shared HTTP client
  type: forbidden-tech
  owner: team:platform
spec:
  severity: warning
  intent: One HTTP client means one place for retries, timeouts, and tracing.
  requirement: >
    Use our shared HTTP client for outbound calls. Do not add axios or got.
  remediation: Replace the dependency with the shared client.
  checks:
    - evaluator: dependencies
      forbid: [axios, got]
`;
