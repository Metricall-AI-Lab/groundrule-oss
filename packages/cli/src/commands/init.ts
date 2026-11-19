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
import { call, PlatformError, platformUrl, tokenFor } from "../platform.js";

export interface InitOptions {
  targets?: AgentTarget[];
  packs?: string[];
  force?: boolean;
  /** Connect to this organization on the platform instead of listing packs. */
  org?: string;
  url?: string;
}

/** The coding agents an organization told Groundrule it uses, as agent targets. */
const AGENT_TARGET: Record<string, AgentTarget> = {
  claude_code: "claude-code",
  cursor: "cursor",
  copilot: "copilot",
};

async function platformTargets(io: IO, org: string, url: string): Promise<AgentTarget[] | null> {
  const auth = await tokenFor(io, url, org);
  if (!auth) return null;
  try {
    const book = await call<{ org: { slug: string; codingAgents: string[] } }>(
      io,
      url,
      "/v1/cli/rulebook",
      { token: auth.token },
    );
    if (book.org.slug !== org) return null;
    return book.org.codingAgents
      .map((a) => AGENT_TARGET[a])
      .filter((t): t is AgentTarget => t !== undefined);
  } catch (error) {
    if (error instanceof PlatformError) return null;
    throw error;
  }
}

const TARGET_FILES: Record<AgentTarget, string[]> = {
  "agents-md": ["AGENTS.md"],
  "claude-code": ["CLAUDE.md", ".claude"],
  cursor: [".cursor", ".cursorrules"],
  copilot: [".github/copilot-instructions.md", ".github/instructions"],
  coderabbit: [".coderabbit.yaml", ".coderabbit.yml"],
};

const TARGET_OUTPUT: Record<AgentTarget, string> = {
  "agents-md": "AGENTS.md",
  "claude-code": "CLAUDE.md",
  cursor: ".cursor/rules/",
  copilot: ".github/copilot-instructions.md",
  coderabbit: ".coderabbit.yaml",
};

/** What `init` would write, worked out without writing anything. */
export interface InitPlan {
  root: string;
  configFile: string;
  config: string;
  packs: string[];
  targets: AgentTarget[];
  languages: string[];
  org?: string;
  url?: string;
  /** The agents the organization uses, or null when not signed in or not connected. */
  fromPlatform: AgentTarget[] | null;
}

/** The files each agent target writes, for messages. */
export const targetOutputs = (targets: readonly AgentTarget[]) =>
  targets.map((t) => TARGET_OUTPUT[t]);

/** Detect the stack and the agents in use, and decide the config. Returns an exit code on a usage error. */
export async function planInit(io: IO, options: InitOptions): Promise<InitPlan | number> {
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
  const org = options.org?.toLowerCase();
  if (org && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(org)) {
    eprintln(
      io,
      `✕ "${options.org}" isn't an organization URL name. Use the part after groundrule.dev/, e.g. acme.`,
    );
    return EXIT.usage;
  }
  let url: string | undefined;
  if (org) {
    try {
      url = platformUrl(io, options.url);
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;
      eprintln(io, `✕ ${error.message}`);
      return EXIT.usage;
    }
  }
  const fromPlatform = org && url ? await platformTargets(io, org, url) : null;
  const targets = options.targets ?? [
    ...new Set<AgentTarget>([
      "agents-md",
      ...detected,
      ...(fromPlatform ?? []),
      ...(detected.length || fromPlatform?.length ? [] : ["claude-code" as const]),
    ]),
  ];

  // A new repository starts from the essentials: a short set that is all checked. It covers
  // every language; rules for languages the repository doesn't use simply don't apply.
  const packs = org ? [] : (options.packs ?? ["essentials"]);

  // The common case in a few readable lines (RFC 0018). Everything left out has a default:
  // tags (none) and enforcement (changed lines, existing findings reported, fail on blockers).
  const config = [
    ...(org
      ? [
          "# The rules come from your organization on Groundrule.",
          "platform:",
          `  org: ${org}`,
          ...(url && url !== "https://app.groundrule.dev" ? [`  url: ${url}`] : []),
          "",
        ]
      : [
          "# The rules this repository follows. `groundrule packs` lists more.",
          "extends:",
          ...packs.map((p) => `  - groundrule:packs/${p}`),
          "",
        ]),
    "# The files `groundrule sync` writes for your coding agents.",
    "targets:",
    ...targets.map((t) => `  - ${t}`),
    "",
    "# More settings (tags, what fails a check, per-rule overrides):",
    "# https://docs.groundrule.dev/developers/cli/init-and-config/",
    "",
  ].join("\n");

  return {
    root,
    configFile,
    config,
    packs,
    targets,
    languages,
    ...(org ? { org } : {}),
    ...(url ? { url } : {}),
    fromPlatform,
  };
}

/** Write the planned config and the sample standard. */
export async function writeInit(plan: InitPlan): Promise<void> {
  await mkdir(join(plan.root, CONFIG_DIR, "standards"), { recursive: true });
  await writeFile(plan.configFile, plan.config);
  const example = join(plan.root, CONFIG_DIR, "standards", "EXAMPLE-001.yaml.sample");
  if (!(await exists(example))) await writeFile(example, EXAMPLE_STANDARD);
}

export async function init(io: IO, options: InitOptions): Promise<number> {
  const s = style(io);
  const plan = await planInit(io, options);
  if (typeof plan === "number") return plan;
  await writeInit(plan);
  const { org, url, packs, targets, languages, fromPlatform } = plan;

  println(io);
  println(io, ` ${s.green("✓")} Created ${s.bold(`${CONFIG_DIR}/${CONFIG_FILE}`)}`);
  if (org) println(io, `   ${s.dim("Platform")} ${org}${url ? ` on ${url}` : ""}`);
  else println(io, `   ${s.dim("Packs")}    ${packs.join(", ") || "none"}`);
  println(io, `   ${s.dim("Agents")}   ${targets.map((t) => TARGET_OUTPUT[t]).join(", ")}`);
  if (languages.length) println(io, `   ${s.dim("Detected")} ${languages.slice(0, 4).join(", ")}`);
  println(io);
  println(io, ` ${s.bold("Next")}`);
  if (org && fromPlatform === null)
    println(
      io,
      `   0. ${s.bold("groundrule login")}    sign in to ${org} (CI: set GROUNDRULE_TOKEN)`,
    );
  println(
    io,
    `   1. ${s.bold("groundrule sync")}         write instructions for your coding agents`,
  );
  println(io, `   2. ${s.bold("groundrule check --all")}  see what the rules find here today`);
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
