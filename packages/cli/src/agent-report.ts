import { createHash } from "node:crypto";
import { GitError, type LoadedStandard, type RunResult, runChecks } from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import { type AgentCheck as AgentCheckDocument, API_VERSION } from "@groundrule/spec";
import { type IO, VERSION } from "./io.js";
import { detectRepository, platformUrl, tokenFor } from "./platform.js";
import { type OpenedWorkspace, openWorkspace } from "./workspace.js";

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

export type AgentCheck =
  | { ok: true; report: AgentReport; result: RunResult; workspace: OpenedWorkspace }
  | { ok: false; message: string };

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
    return { ok: true, report: agentReport(result, workspace.standards), result, workspace };
  } catch (error) {
    if (error instanceof GitError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Seconds a report may take; the agent is never kept waiting longer. */
const REPORT_TIMEOUT_MS = 2_000;

export interface AgentIdentity {
  name: string;
  via: "hook" | "mcp";
  client?: { name: string; version?: string };
  /** The agent's own session or conversation id; only its hash leaves the computer. */
  sessionId?: string;
}

/** The report a check sends to the workspace (RFC 0012): counts per rule, nothing else. */
export function agentCheckDocument(
  checked: Extract<AgentCheck, { ok: true }>,
  repository: string,
  agent: AgentIdentity,
): AgentCheckDocument {
  const { result, report } = checked;
  const counts = new Map<string, { severity: string; count: number; blocking: boolean }>();
  for (const f of report.findings) {
    const entry = counts.get(f.standardId) ?? { severity: f.severity, count: 0, blocking: false };
    entry.count += 1;
    entry.blocking = entry.blocking || f.blocking;
    counts.set(f.standardId, entry);
  }
  return {
    apiVersion: API_VERSION,
    kind: "AgentCheck",
    metadata: { generatedAt: new Date().toISOString(), cliVersion: VERSION },
    repository: { name: repository },
    agent: {
      name: agent.name,
      via: agent.via,
      ...(agent.client ? { client: agent.client } : {}),
      ...(agent.sessionId
        ? { session: createHash("sha256").update(agent.sessionId).digest("hex") }
        : {}),
    },
    check: {
      mode: result.context.mode,
      ...(result.context.base ? { base: result.context.base } : {}),
      files: result.context.mode === "all" ? result.context.files : result.context.changedFiles,
      standards: result.outcomes.length,
      durationMs: result.context.durationMs,
    },
    findings: [...counts]
      .map(([id, c]) => ({
        id,
        severity: c.severity as AgentCheckDocument["findings"][number]["severity"],
        count: c.count,
        blocking: c.blocking,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 200),
    stopped: report.failed,
  };
}

/**
 * Send the report when the repository is connected and this computer is signed in to its
 * workspace, unless the config says `platform.reports: none`. Fire and forget: a failure, a
 * slow platform or an old platform without the endpoint changes nothing for the agent.
 */
export async function reportAgentCheck(
  io: IO,
  checked: AgentCheck,
  agent: AgentIdentity,
): Promise<boolean> {
  if (!checked.ok) return false;
  const { config, root } = checked.workspace;
  const platform = config.platform;
  if (!platform || platform.reports === "none") return false;
  try {
    const url = platformUrl(io, undefined, config);
    const auth = await tokenFor(io, url, platform.org);
    if (!auth) return false;
    const repository =
      checked.workspace.platform?.rulebook.target.repository?.name ??
      platform.repository ??
      (await detectRepository(root));
    if (!repository) return false;
    const document = agentCheckDocument(checked, repository, agent);
    const doFetch = io.fetch ?? fetch;
    await doFetch(`${url}/api/v1/cli/agent-checks`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": `groundrule-cli/${VERSION}`,
        authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}
