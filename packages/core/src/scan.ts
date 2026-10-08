// `groundrule scan`: observe a repository without changing or enforcing anything. Detect
// its stack, the agent instruction files and tool configurations it already has, and how
// every applicable rule would do today. The report holds counts and at most a few
// one-line, redacted snippets per rule; never whole files.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
  type AgentFileKind,
  API_VERSION,
  Config,
  type Finding,
  type ScanAgentFile,
  type ScanExample,
  type ScanOutcome,
  type ScanReport,
  type ScanRule,
  type ScanTool,
} from "@groundrule/spec";
import picomatch from "picomatch";
import type { Evaluator } from "./evaluator.js";
import { MANAGED_BEGIN } from "./generated.js";
import { inspectRepository } from "./repository.js";
import { runChecks } from "./runner.js";
import { matchesScope } from "./scope.js";
import { CONFIG_DIR, CONFIG_FILE, type LoadedStandard, type Workspace } from "./workspace.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  /\bgrt_[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
];
/** user:password@ in connection strings; the scheme and host stay readable. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi;
/** Quoted values assigned to secret-sounding names. */
const ASSIGNED =
  /((?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth)[\w-]*["']?\s*[:=]\s*["'])([^"'\s]{4,})(["'])/gi;
/** Long, random-looking strings. */
const HIGH_ENTROPY = /[A-Za-z0-9+/_=-]{32,}/g;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Mask anything that looks like a credential. Errs on the side of masking. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  out = out.replace(URL_CREDENTIALS, "$1[redacted]@");
  out = out.replace(
    ASSIGNED,
    (_m, before: string, _value: string, after: string) => `${before}[redacted]${after}`,
  );
  out = out.replace(HIGH_ENTROPY, (m) => (entropy(m) >= 4 ? "[redacted]" : m));
  return out;
}

// ---------------------------------------------------------------------------
// Agent files
// ---------------------------------------------------------------------------

const AGENT_FILES: [RegExp, AgentFileKind][] = [
  [/(^|\/)AGENTS\.md$/, "agents-md"],
  [/(^|\/)CLAUDE(\.local)?\.md$/, "claude-md"],
  [/^\.claude\/(rules|agents|commands)\/.+\.md$/, "claude-rules"],
  [/^\.cursor\/rules\/.+\.mdc?$/, "cursor-rules"],
  [/(^|\/)\.cursorrules$/, "cursorrules"],
  [/^\.github\/copilot-instructions\.md$/, "copilot-instructions"],
  [/^\.github\/instructions\/.+\.instructions\.md$/, "copilot-path-instructions"],
  [/(^|\/)GEMINI\.md$/, "gemini-md"],
  [/^(\.windsurfrules|\.windsurf\/rules\/.+\.md)$/, "windsurf-rules"],
  [/(^|\/)CONVENTIONS\.md$/, "aider-conventions"],
];

const IGNORED_DIRS = /(^|\/)(node_modules|vendor|dist|build|\.git)\//;

export async function detectAgentFiles(
  root: string,
  files: readonly string[],
): Promise<ScanAgentFile[]> {
  const out: ScanAgentFile[] = [];
  for (const path of files) {
    if (IGNORED_DIRS.test(path)) continue;
    const kind = AGENT_FILES.find(([re]) => re.test(path))?.[1];
    if (!kind) continue;
    const text = await readFile(join(root, path), "utf8").catch(() => null);
    if (text === null) continue;
    const lines = text.split("\n");
    out.push({
      path,
      kind,
      lines: lines.length,
      bytes: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
      managed: text.includes(MANAGED_BEGIN),
      headings: lines.filter((l) => /^#{1,6}\s/.test(l)).length,
      bullets: lines.filter((l) => /^\s*([-*+]|\d+\.)\s+\S/.test(l)).length,
    });
    if (out.length >= 100) break;
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Tool configurations
// ---------------------------------------------------------------------------

type Facts = ScanTool["facts"];
interface ToolRule {
  id: string;
  match: RegExp;
  facts?: (text: string) => Facts;
  /** Only when the file mentions this (e.g. [tool.ruff] in pyproject.toml). */
  contains?: RegExp;
}

/** tsconfig is JSON with comments and trailing commas. */
function looseJson(text: string): Record<string, unknown> | undefined {
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    const value = JSON.parse(stripped) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const TOOLS: ToolRule[] = [
  {
    id: "eslint",
    match: /(^|\/)(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/,
  },
  {
    id: "prettier",
    match: /(^|\/)(\.prettierrc(\.(js|cjs|json|ya?ml|toml))?|prettier\.config\.(js|mjs|cjs))$/,
  },
  { id: "biome", match: /(^|\/)biome\.jsonc?$/ },
  {
    id: "typescript",
    match: /(^|\/)tsconfig(\.[\w-]+)?\.json$/,
    facts: (text) => {
      const options = (looseJson(text)?.compilerOptions ?? {}) as Record<string, unknown>;
      const facts: Facts = {};
      for (const key of ["strict", "noUncheckedIndexedAccess", "noImplicitAny"]) {
        if (typeof options[key] === "boolean") facts[key] = options[key] as boolean;
      }
      const ext = looseJson(text)?.extends;
      if (typeof ext === "string") facts.extends = ext.slice(0, 200);
      return facts;
    },
  },
  { id: "ruff", match: /(^|\/)(\.?ruff\.toml)$/ },
  { id: "ruff", match: /(^|\/)pyproject\.toml$/, contains: /^\[tool\.ruff/m },
  { id: "black", match: /(^|\/)pyproject\.toml$/, contains: /^\[tool\.black\]/m },
  { id: "mypy", match: /(^|\/)(mypy\.ini|\.mypy\.ini)$/ },
  { id: "mypy", match: /(^|\/)pyproject\.toml$/, contains: /^\[tool\.mypy\]/m },
  { id: "flake8", match: /(^|\/)\.flake8$/ },
  { id: "pylint", match: /(^|\/)(\.pylintrc|pylintrc)$/ },
  { id: "checkstyle", match: /(^|\/)checkstyle[\w-]*\.xml$/ },
  { id: "spotbugs", match: /(^|\/)spotbugs[\w-]*\.xml$/ },
  { id: "pmd", match: /(^|\/)pmd[\w-]*\.xml$/ },
  { id: "golangci-lint", match: /(^|\/)\.golangci\.(ya?ml|toml|json)$/ },
  { id: "rustfmt", match: /(^|\/)\.?rustfmt\.toml$/ },
  { id: "clippy", match: /(^|\/)\.?clippy\.toml$/ },
  { id: "editorconfig", match: /^\.editorconfig$/ },
  {
    id: "codeowners",
    match: /^(\.github\/|docs\/)?CODEOWNERS$/,
    facts: (text) => ({
      rules: text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length,
    }),
  },
  { id: "semgrep", match: /(^|\/)\.semgrep(\.ya?ml|\/.+\.ya?ml)$/ },
  { id: "pre-commit", match: /^\.pre-commit-config\.ya?ml$/ },
  { id: "dependabot", match: /^\.github\/dependabot\.ya?ml$/ },
  { id: "renovate", match: /^(\.github\/)?(renovate|\.renovaterc)(\.json5?)?$/ },
  { id: "github-actions", match: /^\.github\/workflows\/[^/]+\.ya?ml$/ },
  { id: "gitlab-ci", match: /^\.gitlab-ci\.ya?ml$/ },
  { id: "docker", match: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w-]+\.Dockerfile)$/ },
  { id: "docker-compose", match: /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/ },
  { id: "terraform", match: /\.tf$/ },
  { id: "helm", match: /(^|\/)Chart\.yaml$/ },
  { id: "kustomize", match: /(^|\/)kustomization\.ya?ml$/ },
];

/** One entry per tool; files of the same tool (e.g. workflows) are counted in `files`. */
export async function detectTools(root: string, files: readonly string[]): Promise<ScanTool[]> {
  const found = new Map<string, ScanTool>();
  const counts = new Map<string, number>();
  for (const path of files) {
    if (IGNORED_DIRS.test(path)) continue;
    for (const rule of TOOLS) {
      if (!rule.match.test(path)) continue;
      const needsText = rule.contains || rule.facts;
      const text = needsText ? await readFile(join(root, path), "utf8").catch(() => "") : "";
      if (rule.contains && !rule.contains.test(text)) continue;
      const existing = found.get(rule.id);
      const depth = (p: string) => p.split("/").length;
      counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
      // The shallowest file describes the tool (e.g. the root tsconfig.json, not a package's).
      if (!existing || depth(path) < depth(existing.path))
        found.set(rule.id, { id: rule.id, path, facts: rule.facts ? rule.facts(text) : {} });
    }
    if (found.size >= 100) break;
  }
  for (const tool of found.values()) {
    const n = counts.get(tool.id) ?? 1;
    if (n > 1) tool.facts.files = n;
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

export interface ScanOptions {
  root: string;
  /** Rules to observe, e.g. the whole bundled catalog. `origin` is reported as the pack. */
  standards: LoadedStandard[];
  evaluators: readonly Evaluator<unknown>[];
  cliVersion: string;
  /** Include one-line, redacted snippets in examples. */
  snippets: boolean;
  repositoryName?: string;
  tags?: string[];
  files?: readonly string[];
  now?: Date;
}

async function gitValue(root: string, args: string[]): Promise<string | undefined> {
  try {
    return (await execFileAsync("git", args, { cwd: root })).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

const isSecurityRule = (s: LoadedStandard) => s.standard.metadata.category === "security";

const MANIFESTS =
  /(^|\/)(package\.json|pom\.xml|build\.gradle(\.kts)?|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile|composer\.json)$/;

/**
 * How many files a rule actually looks at here: the rule's scope narrowed by each check's
 * own file patterns. Repository-level checks (required or forbidden files) count the
 * repository itself, so "clean" stays meaningful; checks about a change count nothing.
 */
function filesChecked(loaded: LoadedStandard, files: readonly string[]): number {
  const { paths, exclude } = loaded.standard.spec.scope;
  const scoped = files.filter((path) =>
    matchesScope({ ...(paths ? { paths } : {}), ...(exclude ? { exclude } : {}) }, { path }),
  );
  const seen = new Set<string>();
  let repositoryLevel = false;
  for (const check of loaded.standard.spec.checks) {
    const options = check as { evaluator: string; include?: string[]; exclude?: string[] };
    if (options.evaluator === "files") {
      repositoryLevel = true;
      continue;
    }
    if (options.evaluator === "change-set" || options.evaluator === "llm") continue;
    const candidates =
      options.evaluator === "dependencies" ? scoped.filter((f) => MANIFESTS.test(f)) : scoped;
    const include = options.include?.length
      ? picomatch(options.include, { dot: true })
      : () => true;
    const skip = options.exclude?.length ? picomatch(options.exclude, { dot: true }) : () => false;
    for (const file of candidates) if (include(file) && !skip(file)) seen.add(file);
  }
  return seen.size + (repositoryLevel && seen.size === 0 ? 1 : 0);
}

export async function scanRepository(options: ScanOptions): Promise<ScanReport> {
  const started = performance.now();
  const { root } = options;
  const workspace: Workspace = {
    root,
    configFile: join(root, CONFIG_DIR, CONFIG_FILE),
    config: Config.parse({
      apiVersion: API_VERSION,
      kind: "Config",
      tags: options.tags ?? [],
      enforcement: { scope: "all", legacy: "report", failOn: "none" },
    }),
    standards: options.standards,
    exceptions: [],
    diagnostics: [],
  };
  const repo = await inspectRepository(workspace, options.files);
  const result = await runChecks({
    workspace,
    evaluators: options.evaluators,
    mode: "all",
    files: repo.files,
  });

  const lines = new Map<string, string[] | null>();
  const lineOf = async (file: string, line: number) => {
    if (!lines.has(file))
      lines.set(
        file,
        await readFile(join(root, file), "utf8").then(
          (t) => t.split("\n"),
          () => null,
        ),
      );
    return lines.get(file)?.[line - 1];
  };

  const rules: ScanRule[] = [];
  for (const outcome of result.outcomes) {
    const loaded = options.standards.find((s) => s.standard.metadata.id === outcome.id);
    if (!loaded) continue;
    const own = result.findings.filter(
      (f) => f.standardId === outcome.id && (f.status === "violation" || f.status === "concern"),
    );
    const evaluated =
      outcome.status !== "skipped" &&
      outcome.status !== "guidance" &&
      outcome.status !== "not-evaluable";
    let kind: ScanOutcome =
      outcome.status === "skipped"
        ? "not-applicable"
        : outcome.status === "guidance"
          ? "guidance"
          : outcome.status === "not-evaluable"
            ? "not-evaluable"
            : own.length
              ? "violations"
              : "clean";
    const filesInScope = evaluated ? filesChecked(loaded, repo.files) : 0;
    let reason = outcome.reason;
    // Passing because there was nothing to look at isn't passing.
    if (kind === "clean" && filesInScope === 0) {
      kind = "not-applicable";
      reason = "Nothing in this repository for it to check.";
    }
    const examples: ScanExample[] = [];
    for (const f of [...own].sort(byStrength).slice(0, 3)) {
      const example: ScanExample = { message: f.message.slice(0, 300) };
      if (f.location) {
        example.file = f.location.file;
        example.line = f.location.startLine;
        if (options.snippets && !isSecurityRule(loaded)) {
          const text = await lineOf(f.location.file, f.location.startLine);
          if (text?.trim()) example.snippet = redactSecrets(text.trim()).slice(0, 200);
        }
      }
      examples.push(example);
    }
    rules.push({
      id: outcome.id,
      version: loaded.standard.metadata.version,
      pack: loaded.origin.slice(0, 120),
      severity: outcome.severity,
      outcome: kind,
      findings: own.length,
      filesInScope,
      filesAffected: new Set(own.map((f) => f.location?.file).filter(Boolean)).size,
      examples,
      ...(reason && kind !== "clean" && kind !== "violations"
        ? { reason: reason.slice(0, 300) }
        : {}),
    });
  }
  // Guidance-only rules follow their pack: when none of a pack's checks found anything to
  // look at here (e.g. Docker rules in a repository without Dockerfiles), its guidance
  // doesn't apply either.
  const checkable = new Set(rules.filter((r) => r.outcome !== "guidance").map((r) => r.pack));
  const fitting = new Set(rules.filter((r) => r.filesInScope > 0).map((r) => r.pack));
  for (const rule of rules) {
    if (rule.outcome === "guidance" && checkable.has(rule.pack) && !fitting.has(rule.pack)) {
      rule.outcome = "not-applicable";
      rule.reason = "Its pack has nothing to check in this repository.";
    }
  }
  rules.sort((a, b) => a.id.localeCompare(b.id));

  const commit = await gitValue(root, ["rev-parse", "HEAD"]);
  // symbolic-ref also works before the first commit; detached HEADs have no branch.
  const branch = await gitValue(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const count = (o: ScanOutcome) => rules.filter((r) => r.outcome === o).length;
  return {
    apiVersion: API_VERSION,
    kind: "ScanReport",
    metadata: {
      generatedAt: (options.now ?? new Date()).toISOString(),
      cliVersion: options.cliVersion,
      durationMs: Math.round(performance.now() - started),
      snippets: options.snippets,
    },
    repository: {
      name: (options.repositoryName ?? basename(root)).slice(0, 200),
      ...(commit && /^[0-9a-f]{40}$/.test(commit) ? { commit } : {}),
      ...(branch && branch !== "HEAD" ? { branch: branch.slice(0, 255) } : {}),
      files: repo.files.length,
    },
    stack: { languages: repo.languages.slice(0, 40), frameworks: repo.frameworks.slice(0, 40) },
    agentFiles: await detectAgentFiles(root, repo.files),
    tools: await detectTools(root, repo.files),
    rules,
    summary: {
      rules: rules.length,
      clean: count("clean"),
      violations: count("violations"),
      guidance: count("guidance"),
      notApplicable: count("not-applicable"),
      notEvaluable: count("not-evaluable"),
      findings: rules.reduce((n, r) => n + r.findings, 0),
    },
  };
}

/** Violations before concerns, then by file and line, so examples are stable. */
function byStrength(a: Finding, b: Finding): number {
  if (a.status !== b.status) return a.status === "violation" ? -1 : 1;
  const fa = a.location?.file ?? "";
  const fb = b.location?.file ?? "";
  return fa.localeCompare(fb) || (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0);
}
