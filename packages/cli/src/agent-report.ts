import { GitError, type LoadedStandard, type RunResult, runChecks } from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import type { IO } from "./io.js";
import { openWorkspace } from "./workspace.js";

/** Findings listed for an agent at most; the rest are counted. */
const MAX_LISTED = 30;

export interface AgentFinding {
  standardId: string;
  title: string;
  severity: string;
  blocking: boolean;
  source: string;
  file?: string;
  line?: number;
  message: string;
  fix?: string;
}

export interface AgentReport {
  /** Shown to the agent. */
  text: string;
  failed: boolean;
  findings: AgentFinding[];
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const sentence = (text: string) => (/[.!?:]$/.test(text) ? text : `${text}.`);

/**
 * A check result written for a coding agent: what to fix before finishing, where, and how.
 * Only findings the change introduced; legacy and suppressed findings are left out so the
 * agent fixes its own work rather than rewriting unrelated code.
 */
export function agentReport(result: RunResult, standards: readonly LoadedStandard[]): AgentReport {
  const byId = new Map(standards.map((s) => [s.standard.metadata.id, s.standard]));
  const findings: AgentFinding[] = result.findings
    .filter(
      (f) => (f.status === "violation" || f.status === "concern") && f.isNew && !f.suppressedBy,
    )
    .map((f) => {
      const standard = byId.get(f.standardId);
      const fix = f.remediation ?? standard?.spec.remediation ?? standard?.spec.agent?.summary;
      return {
        standardId: f.standardId,
        title: standard?.metadata.title ?? f.standardId,
        severity: f.severity,
        blocking: result.blocking.has(f.fingerprint),
        source: f.source,
        ...(f.location ? { file: f.location.file, line: f.location.startLine } : {}),
        message: sentence(oneLine(f.message)),
        ...(fix ? { fix: oneLine(fix) } : {}),
      };
    });

  const where =
    result.context.mode === "all"
      ? "every file"
      : result.context.base
        ? `changes since ${result.context.base}`
        : "uncommitted changes";
  const blocking = findings.filter((f) => f.blocking);
  const other = findings.filter((f) => !f.blocking);
  const line = (f: AgentFinding) =>
    `- ${f.standardId} ${f.title} (${f.severity}${f.source === "ai" ? ", AI" : ""}) at ${f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "the repository"}: ${f.message}${f.fix ? ` Fix: ${f.fix}` : ""}`;

  const parts: string[] = [];
  if (result.failed) {
    parts.push(
      `Groundrule check failed on ${where}: ${blocking.length} blocking ${blocking.length === 1 ? "finding" : "findings"}. Fix ${blocking.length === 1 ? "it" : "them"} before you finish, then check again.`,
    );
    parts.push(...blocking.slice(0, MAX_LISTED).map(line));
  } else
    parts.push(
      `Groundrule check passed on ${where}${result.context.changedFiles || result.context.mode === "all" ? "" : " (nothing changed)"}.`,
    );
  const room = Math.max(0, MAX_LISTED - Math.min(blocking.length, MAX_LISTED));
  if (other.length && room) {
    parts.push(
      `Warnings (they don't fail the check; fix the ones in code you wrote): ${other.length}`,
    );
    parts.push(...other.slice(0, room).map(line));
  }
  const listed = Math.min(blocking.length, MAX_LISTED) + Math.min(other.length, room);
  if (findings.length > listed) parts.push(`…and ${findings.length - listed} more.`);
  if (findings.length)
    parts.push(
      "For the reasoning and examples behind a rule, run `npx @groundrule/cli explain <ID>`.",
    );
  return { text: parts.join("\n"), failed: result.failed, findings };
}

/** A git ref an agent may pass as a base: no options, no spaces. */
export const SAFE_REF = /^(?!-)[A-Za-z0-9._/@{}~^-]{1,200}$/;

export type AgentCheck = { ok: true; report: AgentReport } | { ok: false; message: string };

/**
 * Run the same check as `groundrule check` for a coding agent. Diagnostics go to `io.stderr`;
 * nothing is uploaded. Problems come back as a message rather than an exception.
 */
export async function checkForAgent(
  io: IO,
  options: { base?: string; all?: boolean } = {},
): Promise<AgentCheck> {
  if (options.base !== undefined && !SAFE_REF.test(options.base))
    return { ok: false, message: `"${options.base}" isn't a git ref, such as origin/main.` };
  const workspace = await openWorkspace(io, { use: "checks" });
  if (!workspace)
    return {
      ok: false,
      message:
        "This repository has no Groundrule configuration, or it couldn't be loaded. Run `npx @groundrule/cli doctor`.",
    };
  try {
    const result = await runChecks({
      workspace,
      evaluators: builtinEvaluators,
      ...(options.all ? { mode: "all" as const } : { mode: "changes" as const }),
      ...(options.base && !options.all ? { base: options.base } : {}),
    });
    return { ok: true, report: agentReport(result, workspace.standards) };
  } catch (error) {
    if (error instanceof GitError) return { ok: false, message: error.message };
    throw error;
  }
}
