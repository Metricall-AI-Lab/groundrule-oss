// The result of `groundrule check`, shaped for upload (RFC 0005): repository identity, the
// run's outcome, every applicable standard, and at most 500 findings with one-line, redacted
// snippets. Never file contents or diffs.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  API_VERSION,
  type CheckRun,
  type CheckRunFinding,
  type CheckRunPullRequest,
} from "@groundrule/spec";
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
  now?: Date;
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
  const commit = await gitValue(root, ["rev-parse", "HEAD"]);
  // Pull-request checkouts are detached; their branch comes from the pull request.
  const branch =
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

  const pr = options.pullRequest;
  return {
    apiVersion: API_VERSION,
    kind: "CheckRun",
    metadata: {
      generatedAt: (options.now ?? new Date()).toISOString(),
      cliVersion: options.cliVersion.slice(0, 40),
      durationMs: Math.round(result.context.durationMs),
      snippets: options.snippets,
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
      .map((o) => ({
        id: o.id,
        title: o.title.slice(0, 200),
        severity: o.severity,
        status: o.status,
        violations: o.violations,
        concerns: o.concerns,
      })),
    findings,
    omittedFindings: Math.max(0, reported.length - MAX_FINDINGS),
  };
}
