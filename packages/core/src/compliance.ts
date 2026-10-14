// The compliance record on a check run (RFC 0007): digests that pin down exactly which rules
// were in effect, and the coding agents a change's commits declare. Agents are detected from
// commit metadata only, never from code, and only counts leave the machine.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { CheckRunAuthorship, RolloutStage, Severity, Standard } from "@groundrule/spec";
import type { LoadedStandard } from "./workspace.js";

const execFileAsync = promisify(execFile);

/** JSON with object keys sorted at every level and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha256 = (text: string) =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** The digest of a standard as applied, after customizations. */
export function ruleDigest(standard: Standard): string {
  return sha256(canonicalJson(standard));
}

/**
 * The standard as the organization set it: Advise lowers blockers to warnings while it runs,
 * but the stage says that, so the digest stays the same when a rule moves between stages.
 */
export function appliedStandard(loaded: LoadedStandard): Standard {
  const { standard, stage, originalSeverity } = loaded;
  return stage && originalSeverity
    ? { ...standard, spec: { ...standard.spec, severity: originalSeverity } }
    : standard;
}

export interface RulebookLine {
  id: string;
  digest: string;
  stage?: RolloutStage | undefined;
  severity: Severity;
}

/** One line per rule, `<id> <digest> <stage or -> <severity>`, sorted by ID, joined with \n. */
export function rulebookDigest(rules: readonly RulebookLine[]): string {
  const lines = rules
    .map((r) => `${r.id} ${r.digest} ${r.stage ?? "-"} ${r.severity}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(lines.join("\n"));
}

/**
 * Rules in effect for the rulebook digest: active or deprecated, not turned off, and at any
 * stage but Observe. Teach rules count: they shape what agents write.
 */
export function rulesInEffect(standards: readonly LoadedStandard[]): RulebookLine[] {
  return standards
    .filter(
      (s) =>
        !s.disabled &&
        s.stage !== "observe" &&
        (s.standard.metadata.status === "active" || s.standard.metadata.status === "deprecated"),
    )
    .map((s) => {
      const standard = appliedStandard(s);
      return {
        id: standard.metadata.id,
        digest: ruleDigest(standard),
        stage: s.stage,
        severity: standard.spec.severity,
      };
    });
}

// ---------------------------------------------------------------- authorship

export interface CommitMeta {
  authorName: string;
  authorEmail: string;
  /** The full commit message, for its trailers. */
  message: string;
}

interface Person {
  name: string;
  email: string;
}

/** Known coding agents and how their commits say so. The list grows over time. */
const AGENTS: { name: string; matches: (p: Person) => boolean; inMessage?: RegExp }[] = [
  {
    name: "Claude Code",
    matches: (p) => /^claude\b/i.test(p.name) && /@anthropic\.com$/i.test(p.email),
    inMessage: /Generated with \[?Claude Code\]?/i,
  },
  {
    name: "Cursor",
    matches: (p) => /^cursoragent@cursor\.com$/i.test(p.email),
  },
  {
    name: "GitHub Copilot",
    matches: (p) =>
      /^copilot(-swe-agent)?(\[bot\])?$/i.test(p.name) &&
      /^(\d+\+)?copilot(-swe-agent)?(\[bot\])?@users\.noreply\.github\.com$/i.test(p.email),
  },
  {
    name: "Codex",
    matches: (p) =>
      /^(openai )?codex\b/i.test(p.name) ||
      /^chatgpt-codex-connector\[bot\]$/i.test(p.name) ||
      /codex@openai\.com$/i.test(p.email),
  },
  {
    name: "Aider",
    matches: (p) => /^aider@aider\.chat$/i.test(p.email) || /\(aider\)\s*$/i.test(p.name),
  },
];

const TRAILER = /^co-authored-by:\s*(.+?)\s*<([^>]*)>\s*$/gim;

/** The agents one commit declares, by name. */
export function agentsOf(commit: CommitMeta): string[] {
  const people: Person[] = [{ name: commit.authorName.trim(), email: commit.authorEmail.trim() }];
  for (const m of commit.message.matchAll(TRAILER))
    people.push({ name: (m[1] ?? "").trim(), email: (m[2] ?? "").trim() });
  return AGENTS.filter(
    (a) => people.some((p) => a.matches(p)) || (a.inMessage?.test(commit.message) ?? false),
  ).map((a) => a.name);
}

/** Count the agents a change's commits declare (RFC 0007). Counts only. */
export function detectAgents(commits: readonly CommitMeta[]): CheckRunAuthorship {
  const counts = new Map<string, number>();
  for (const c of commits)
    for (const name of agentsOf(c)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return {
    commits: commits.length,
    agents: [...counts]
      .map(([name, n]) => ({ name, commits: n }))
      .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
      .slice(0, 20),
    method: "commit-metadata",
  };
}

const RECORD = "\x1e";
const FIELD = "\x1f";

/**
 * The authorship of `base..HEAD` from git. Undefined when the history isn't there (e.g. a
 * shallow clone without the base), so the record is left out rather than wrong.
 */
export async function gitAuthorship(
  root: string,
  base: string,
): Promise<CheckRunAuthorship | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--no-merges", `--format=%an${FIELD}%ae${FIELD}%B${RECORD}`, `${base}..HEAD`, "--"],
      { cwd: root, maxBuffer: 1 << 26 },
    );
    const commits = stdout
      .split(RECORD)
      .map((r) => r.replace(/^\n/, ""))
      .filter((r) => r.includes(FIELD))
      .map((r) => {
        const [authorName = "", authorEmail = "", message = ""] = r.split(FIELD);
        return { authorName, authorEmail, message };
      });
    return detectAgents(commits);
  } catch {
    return undefined;
  }
}
