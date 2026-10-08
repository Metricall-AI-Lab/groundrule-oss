import { dirname } from "node:path";
import {
  type Check,
  compareConfidence,
  compareSeverity,
  type ExceptionEntry,
  type Finding,
  isExceptionActive,
  type Scope,
  type Severity,
} from "@groundrule/spec";
import picomatch from "picomatch";
import type { Diagnostic } from "./diagnostics.js";
import type { ChangedFile, EvalContext, Evaluator, EvaluatorFinding } from "./evaluator.js";
import { computeFingerprint } from "./fingerprint.js";
import { isGeneratedFile } from "./generated.js";
import { getChanges, isChangedLine } from "./git.js";
import { inspectRepository } from "./repository.js";
import { matchesScope } from "./scope.js";
import {
  effectiveStandards,
  type LoadedStandard,
  repoReader,
  type Workspace,
} from "./workspace.js";

export type RunMode = "changes" | "all";

export interface RunOptions {
  workspace: Workspace;
  evaluators: readonly Evaluator<unknown>[];
  /** "changes" evaluates the diff against `base` (or uncommitted work); "all" audits everything. */
  mode?: RunMode;
  /** Git ref to compare against in "changes" mode, e.g. origin/main. */
  base?: string;
  /** Only run these standard IDs. */
  only?: readonly string[];
  /** Precomputed inputs (tests, cloud workers). */
  files?: readonly string[];
  changes?: readonly ChangedFile[];
  signal?: AbortSignal;
  log?: EvalContext["log"];
  now?: Date;
}

export type OutcomeStatus =
  | "passed"
  | "failed"
  | "warned"
  | "not-evaluable"
  | "guidance"
  | "skipped";

export interface StandardOutcome {
  id: string;
  title: string;
  severity: Severity;
  status: OutcomeStatus;
  /** Why it was skipped or not evaluable. */
  reason?: string;
  violations: number;
  concerns: number;
}

export interface RunSummary {
  standards: number;
  passed: number;
  failed: number;
  warned: number;
  notEvaluable: number;
  guidance: number;
  skipped: number;
  violations: number;
  concerns: number;
  suppressed: number;
  legacy: number;
  blocking: number;
}

export interface RunResult {
  findings: Finding[];
  outcomes: StandardOutcome[];
  diagnostics: Diagnostic[];
  summary: RunSummary;
  /** True when at least one finding should fail the run (exit code 1). */
  failed: boolean;
  /** Fingerprints of findings that fail the run. */
  blocking: ReadonlySet<string>;
  context: {
    root: string;
    mode: RunMode;
    base?: string;
    files: number;
    changedFiles: number;
    languages: string[];
    frameworks: string[];
    durationMs: number;
  };
}

const FAIL_THRESHOLD: Record<"blocker" | "warning", Severity> = {
  blocker: "blocker",
  warning: "warning",
};

export async function runChecks(options: RunOptions): Promise<RunResult> {
  const started = performance.now();
  const { workspace } = options;
  const { root, config } = workspace;
  const diagnostics: Diagnostic[] = [];
  const log = options.log ?? (() => {});
  const signal = options.signal ?? new AbortController().signal;
  const now = options.now ?? new Date();

  // Never evaluate Groundrule's own files: standards contain examples of forbidden code.
  const repo = await inspectRepository(workspace, options.files);
  const { inGit, files, configPrefix, languages, frameworks } = repo;

  let mode: RunMode = options.mode ?? (config.enforcement.scope === "all" ? "all" : "changes");
  let changes: readonly ChangedFile[] | undefined;
  if (mode === "changes") {
    if (options.changes) changes = options.changes;
    else if (inGit) changes = await getChanges(root, options.base);
    else {
      diagnostics.push({
        severity: "warning",
        file: workspace.configFile,
        message:
          "Not a git repository, so there is no change to compare. Checking every file instead.",
      });
      mode = "all";
    }
  }
  changes = changes?.filter((c) => !c.path.startsWith(configPrefix) && !isGeneratedFile(c.path));
  const changeMap = new Map((changes ?? []).map((c) => [c.path, c]));
  const changedPaths = new Set(
    (changes ?? []).filter((c) => c.status !== "deleted").map((c) => c.path),
  );

  const readFile = repoReader(root);
  const repoTarget = { repository: repo.name, languages, frameworks, tags: config.tags };

  const registry = new Map(options.evaluators.map((e) => [e.id, e]));
  const findings: Finding[] = [];
  const outcomes: StandardOutcome[] = [];

  const selected = workspace.standards.filter(
    (s) => !options.only || options.only.includes(s.standard.metadata.id),
  );
  const effective = new Set(effectiveStandards({ standards: selected }));

  for (const loaded of selected) {
    const { standard } = loaded;
    const base: Omit<StandardOutcome, "status"> = {
      id: standard.metadata.id,
      title: standard.metadata.title,
      severity: standard.spec.severity,
      violations: 0,
      concerns: 0,
    };

    if (!effective.has(loaded)) {
      outcomes.push({
        ...base,
        status: "skipped",
        reason: loaded.disabled
          ? `Disabled by config override${loaded.overrideReason ? `: ${loaded.overrideReason}` : ""}`
          : `Status is ${standard.metadata.status}`,
      });
      continue;
    }

    // languages, frameworks, tags, and repositories apply at repository level.
    const { paths, exclude, ...repoScope } = standard.spec.scope;
    if (!matchesScope(repoScope, repoTarget)) {
      outcomes.push({
        ...base,
        status: "skipped",
        reason: notApplicableReason(repoScope, repoTarget),
      });
      continue;
    }
    if (standard.spec.checks.length === 0) {
      outcomes.push({
        ...base,
        status: "guidance",
        reason: "Guidance for agents and reviewers; no automated check.",
      });
      continue;
    }

    const fileScope = { ...(paths ? { paths } : {}), ...(exclude ? { exclude } : {}) };
    const scopedFiles = files.filter((path) => matchesScope(fileScope, { path }));
    const targetFiles =
      mode === "changes" ? scopedFiles.filter((f) => changedPaths.has(f)) : scopedFiles;
    const context: EvalContext = {
      root,
      repository: repoTarget.repository,
      languages,
      frameworks,
      tags: config.tags,
      files: scopedFiles,
      targetFiles,
      ...(changes
        ? { changes: changes.filter((c) => scopedFiles.includes(c.path) || c.status === "deleted") }
        : {}),
      readFile,
      signal,
      log,
    };

    const standardFindings: Finding[] = [];
    const unavailable: string[] = [];

    for (const [index, check] of standard.spec.checks.entries()) {
      const evaluator = registry.get(check.evaluator);
      if (!evaluator) {
        unavailable.push(`Unknown evaluator "${check.evaluator}"`);
        diagnostics.push({
          severity: "error",
          file: loaded.file,
          path: `spec.checks[${index}].evaluator`,
          message: `Unknown evaluator "${check.evaluator}". Available: ${[...registry.keys()].sort().join(", ")}.`,
        });
        continue;
      }

      const parsed = evaluator.optionsSchema.safeParse(checkOptions(check));
      if (!parsed.success) {
        unavailable.push(`Invalid ${evaluator.id} options`);
        for (const issue of parsed.error.issues) {
          diagnostics.push({
            severity: "error",
            file: loaded.file,
            path: `spec.checks[${index}]${issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("")}`,
            message: issue.message,
          });
        }
        continue;
      }

      const support = evaluator.supports ? await evaluator.supports(context) : true;
      if (support !== true) {
        unavailable.push(support);
        continue;
      }

      let raw: EvaluatorFinding[];
      try {
        raw = await evaluator.evaluate({
          standard,
          check,
          options: parsed.data,
          standardDir: dirname(loaded.file),
          context,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        unavailable.push(`${evaluator.id} failed: ${message}`);
        diagnostics.push({
          severity: "warning",
          file: loaded.file,
          path: `spec.checks[${index}]`,
          message: `${evaluator.id} failed: ${message}`,
        });
        continue;
      }

      for (const item of raw) {
        if (item.status === "pass") continue;
        standardFindings.push(
          toFinding(item, {
            loaded,
            check,
            evaluator,
            mode,
            changeMap,
            scope: config.enforcement.scope,
          }),
        );
      }
    }

    // Expired exceptions are reported once by loadWorkspace and never suppress findings.
    for (const finding of standardFindings) {
      const exception = findException(workspace.exceptions, finding, now);
      if (exception) finding.suppressedBy = exception.id;
    }

    const kept =
      config.enforcement.legacy === "ignore"
        ? standardFindings.filter((f) => f.isNew || f.status === "not-evaluable")
        : standardFindings;
    findings.push(...kept);

    const violations = kept.filter((f) => f.status === "violation" && !f.suppressedBy).length;
    const concerns = kept.filter((f) => f.status === "concern" && !f.suppressedBy).length;
    const allUnavailable = unavailable.length === standard.spec.checks.length;
    outcomes.push({
      ...base,
      violations,
      concerns,
      status: allUnavailable && kept.length === 0 ? "not-evaluable" : "passed",
      ...(unavailable.length > 0
        ? { reason: unavailable.map((r) => (/[.!?]$/.test(r) ? r : `${r}.`)).join(" ") }
        : {}),
    });
  }

  const blocking = new Set<string>();
  for (const finding of findings) {
    if (isBlocking(finding, config.enforcement)) blocking.add(finding.fingerprint);
  }
  for (const outcome of outcomes) {
    const own = findings.filter((f) => f.standardId === outcome.id && !f.suppressedBy);
    if (own.some((f) => blocking.has(f.fingerprint))) outcome.status = "failed";
    else if (
      outcome.status === "passed" &&
      own.some(
        (f) =>
          (f.status === "violation" || f.status === "concern") &&
          (f.isNew || config.enforcement.legacy === "enforce"),
      )
    )
      // Legacy-only findings don't make a standard "warned"; they are reported separately.
      outcome.status = "warned";
  }

  findings.sort(
    (a, b) =>
      Number(blocking.has(b.fingerprint)) - Number(blocking.has(a.fingerprint)) ||
      compareSeverity(b.severity, a.severity) ||
      (a.location?.file ?? "").localeCompare(b.location?.file ?? "") ||
      (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0) ||
      a.standardId.localeCompare(b.standardId),
  );

  const active = findings.filter((f) => !f.suppressedBy);
  const summary: RunSummary = {
    standards: outcomes.length,
    passed: outcomes.filter((o) => o.status === "passed").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    warned: outcomes.filter((o) => o.status === "warned").length,
    notEvaluable: outcomes.filter((o) => o.status === "not-evaluable").length,
    guidance: outcomes.filter((o) => o.status === "guidance").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    violations: active.filter((f) => f.status === "violation").length,
    concerns: active.filter((f) => f.status === "concern").length,
    suppressed: findings.length - active.length,
    legacy: active.filter((f) => !f.isNew && f.status !== "not-evaluable").length,
    blocking: blocking.size,
  };

  return {
    findings,
    outcomes,
    diagnostics,
    summary,
    failed: blocking.size > 0,
    blocking,
    context: {
      root,
      mode,
      ...(options.base ? { base: options.base } : {}),
      files: files.length,
      changedFiles: changedPaths.size,
      languages,
      frameworks,
      durationMs: Math.round(performance.now() - started),
    },
  };
}

function checkOptions(check: Check): Record<string, unknown> {
  const { evaluator: _evaluator, minConfidence: _minConfidence, ...rest } = check;
  return rest;
}

function toFinding(
  item: EvaluatorFinding,
  ctx: {
    loaded: LoadedStandard;
    check: Check;
    evaluator: Evaluator<unknown>;
    mode: RunMode;
    changeMap: Map<string, ChangedFile>;
    scope: "changed-lines" | "changed-files" | "all";
  },
): Finding {
  const { standard } = ctx.loaded;
  let status = item.status;
  if (
    status === "violation" &&
    ctx.check.minConfidence &&
    compareConfidence(item.confidence, ctx.check.minConfidence) < 0
  ) {
    status = "concern";
  }

  let isNew = true;
  if (ctx.mode === "changes") {
    const location = item.location;
    if (!location) isNew = false;
    else {
      const change = ctx.changeMap.get(location.file);
      isNew =
        ctx.scope === "changed-files"
          ? change !== undefined && change.status !== "deleted"
          : isChangedLine(change, location.startLine, location.endLine ?? location.startLine);
    }
  }

  return {
    standardId: standard.metadata.id,
    standardVersion: standard.metadata.version,
    evaluator: ctx.evaluator.id,
    source: ctx.evaluator.source,
    status,
    severity: standard.spec.severity,
    confidence: item.confidence,
    ...(item.location ? { location: item.location } : {}),
    message: item.message,
    evidence: item.evidence ?? [],
    ...(item.remediation
      ? { remediation: item.remediation }
      : standard.spec.remediation
        ? { remediation: standard.spec.remediation.trim() }
        : {}),
    isNew,
    fingerprint:
      item.fingerprint ??
      computeFingerprint({
        standardId: standard.metadata.id,
        evaluator: ctx.evaluator.id,
        ...(item.location ? { file: item.location.file } : {}),
        snippet: item.snippet ?? item.message,
      }),
  };
}

function findException(exceptions: readonly ExceptionEntry[], finding: Finding, now: Date) {
  return exceptions.find((entry) => {
    if (entry.standard !== finding.standardId) return false;
    if (!isExceptionActive(entry, now)) return false;
    const file = finding.location?.file;
    return file ? picomatch.isMatch(file, entry.paths, { dot: true }) : entry.paths.includes("**");
  });
}

function isBlocking(
  finding: Finding,
  enforcement: { failOn: "blocker" | "warning" | "none"; legacy: "report" | "ignore" | "enforce" },
): boolean {
  if (enforcement.failOn === "none") return false;
  if (finding.status !== "violation" || finding.suppressedBy) return false;
  if (!finding.isNew && enforcement.legacy !== "enforce") return false;
  return compareSeverity(finding.severity, FAIL_THRESHOLD[enforcement.failOn]) >= 0;
}

function notApplicableReason(
  scope: Scope,
  target: { languages: readonly string[]; frameworks: readonly string[]; tags: readonly string[] },
): string {
  const missing = (label: string, wanted?: string[], have?: readonly string[]) =>
    wanted?.length &&
    !wanted.some((w) => have?.map((h) => h.toLowerCase()).includes(w.toLowerCase()))
      ? `${label} ${wanted.join("/")} not found`
      : undefined;
  const reasons = [
    missing("language", scope.languages, target.languages),
    missing("framework", scope.frameworks, target.frameworks),
    missing("tag", scope.tags, target.tags),
  ].filter(Boolean);
  return `Not applicable: ${reasons.length ? reasons.join(", ") : "repository not in scope"}.`;
}
