// The result of `groundrule check`, shaped for upload (RFC 0005): repository identity, the
// run's outcome, every applicable standard, and at most 500 findings with one-line, redacted
// snippets. Never file contents or diffs. With RFC 0007 it is also a compliance record: which
// rules were in effect, which exceptions applied, and which coding agents the commits declare.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  API_VERSION,
  type CheckRun,
  type CheckRunAuthorship,
  type CheckRunException,
  type CheckRunFinding,
  type CheckRunPullRequest,
  type ExceptionEntry,
} from "@groundrule/spec";
import { appliedStandard, rulebookDigest, ruleDigest, rulesInEffect } from "./compliance.js";
import { enforcementOf } from "./enforcement.js";
import type { RunResult } from "./runner.js";
import { redactSecrets } from "./scan.js";
import type { LoadedStandard } from "./workspace.js";

const execFileAsync = promisify(execFile);
const MAX_FINDINGS = 500;

export interface CheckRunOptions {
  result: RunResult;
  standards: readonly LoadedStandard[];
  cliVersion: string;
  /** Include the offending line of each finding, redacted. */
  snippets: boolean;
  failOn: CheckRun["failOn"];
  repositoryName: string;
  pullRequest?: CheckRunPullRequest | undefined;
  /** The commit and branch, when the caller knows them better than git (hosted checks have no .git). */
  commit?: string | undefined;
  branch?: string | undefined;
  now?: Date;
  /** The repository's exceptions; those that suppressed a finding are recorded. */
  exceptions?: readonly ExceptionEntry[];
  /**
   * Every rule the repository received, for the rulebook digest. Unlike `standards`, it
   * includes Teach rules, which agents follow but checks don't run.
   */
  rulebook?: {
    standards: readonly LoadedStandard[];
    platform?: { org: string; generatedAt: string } | undefined;
  };
  /** Agents the change's commits declare; false when turned off with --no-authorship. */
  authorship?: CheckRunAuthorship | false | undefined;
}

async function gitValue(root: string, args: string[]): Promise<string | undefined> {
  try {
    return (await execFileAsync("git", args, { cwd: root })).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function buildCheckRun(options: CheckRunOptions): Promise<CheckRun> {
  const { result } = options;
  const { root } = result.context;
  const commit = options.commit ?? (await gitValue(root, ["rev-parse", "HEAD"]));
  // Pull-request checkouts are detached; their branch comes from the pull request.
  const branch =
    options.branch ??
    options.pullRequest?.headRef ??
    (await gitValue(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]));

  const byId = new Map(options.standards.map((s) => [s.standard.metadata.id, s]));
  const security = (id: string) => byId.get(id)?.standard.metadata.category === "security";

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

  // Already ordered by the runner: blocking first, then severity, file and line.
  const reported = result.findings.filter(
    (f) => (f.status === "violation" || f.status === "concern") && !f.suppressedBy,
  );
  const findings: CheckRunFinding[] = [];
  for (const f of reported.slice(0, MAX_FINDINGS)) {
    const finding: CheckRunFinding = {
      standardId: f.standardId,
      severity: f.severity,
      status: f.status === "concern" ? "concern" : "violation",
      source: f.source,
      blocking: result.blocking.has(f.fingerprint),
      isNew: f.isNew,
      message: f.message.slice(0, 300),
    };
    if (f.location) {
      finding.file = f.location.file.slice(0, 400);
      finding.line = f.location.startLine;
      if (options.snippets && !security(f.standardId)) {
        const text = (await lineOf(f.location.file, f.location.startLine))?.trim();
        if (text) finding.snippet = redactSecrets(text).slice(0, 200);
      }
    }
    findings.push(finding);
  }

  const suppressed = new Map<string, number>();
  for (const f of result.findings)
    if (f.suppressedBy) suppressed.set(f.suppressedBy, (suppressed.get(f.suppressedBy) ?? 0) + 1);
  const exceptions: CheckRunException[] = (options.exceptions ?? [])
    .filter((e) => suppressed.has(e.id))
    .slice(0, 200)
    .map((e) => ({
      id: e.id,
      standard: e.standard,
      expires: e.expires,
      ...(e.approvedBy ? { approvedBy: e.approvedBy.slice(0, 200) } : {}),
      suppressed: suppressed.get(e.id) ?? 0,
    }));

  const inEffect = options.rulebook ? rulesInEffect(options.rulebook.standards) : undefined;
  const platform = options.rulebook?.platform;
  const authorship = options.authorship;

  const pr = options.pullRequest;
  return {
    apiVersion: API_VERSION,
    kind: "CheckRun",
    metadata: {
      generatedAt: (options.now ?? new Date()).toISOString(),
      cliVersion: options.cliVersion.slice(0, 40),
      durationMs: Math.round(result.context.durationMs),
      snippets: options.snippets,
      ...(authorship === false ? { authorship: false } : {}),
    },
    repository: {
      name: options.repositoryName.slice(0, 200),
      ...(commit && /^[0-9a-f]{40}$/.test(commit) ? { commit } : {}),
      ...(branch && branch !== "HEAD" ? { branch: branch.slice(0, 255) } : {}),
    },
    ...(pr ? { pullRequest: pr } : {}),
    mode: result.context.mode === "all" ? "all" : "changes",
    ...(result.context.base ? { base: result.context.base.slice(0, 255) } : {}),
    files: result.context.files,
    changedFiles: result.context.changedFiles,
    passed: !result.failed,
    failOn: options.failOn,
    summary: { ...result.summary },
    outcomes: result.outcomes
      .filter((o) => o.status !== "skipped")
      .slice(0, 2000)
      .map((o) => {
        const loaded = byId.get(o.id);
        const standard = loaded && appliedStandard(loaded);
        return {
          id: o.id,
          title: o.title.slice(0, 200),
          severity: o.severity,
          status: o.status,
          violations: o.violations,
          concerns: o.concerns,
          ...(standard
            ? {
                version: standard.metadata.version,
                digest: ruleDigest(standard),
                ...(loaded.stage ? { stage: loaded.stage } : {}),
                enforcement: enforcementOf(standard.spec.checks.map((c) => c.evaluator)),
              }
            : {}),
        };
      }),
    findings,
    omittedFindings: Math.max(0, reported.length - MAX_FINDINGS),
    ...(inEffect
      ? {
          rulebook: {
            digest: rulebookDigest(inEffect),
            standards: inEffect.length,
            source: platform ? ("platform" as const) : ("local" as const),
            ...(platform
              ? { platform: { org: platform.org.slice(0, 100), generatedAt: platform.generatedAt } }
              : {}),
          },
        }
      : {}),
    ...(exceptions.length ? { exceptions } : {}),
    ...(authorship && result.context.mode !== "all" ? { authorship } : {}),
  };
}
