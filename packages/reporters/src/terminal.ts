import { formatDiagnostic } from "@groundrule/core";
import type { Finding } from "@groundrule/spec";
import {
  locationLabel,
  pluralize,
  type ReportInput,
  SOURCE_LABEL,
  standardsById,
} from "./input.js";
import { createStyle, type Style } from "./style.js";

const MAX_PER_STANDARD = 5;

export interface TerminalOptions {
  color?: boolean;
  /** Also list legacy and suppressed findings. */
  verbose?: boolean;
}

/**
 * Human output for `groundrule check`. Design rules (Build Plan §15.4):
 * blockers first, a fix on every finding, color only for meaning, fits 80 columns.
 */
export function renderTerminal(input: ReportInput, options: TerminalOptions = {}): string {
  const s = createStyle(options.color ?? false);
  const { result } = input;
  const byId = standardsById(input);
  const out: string[] = [""];

  const changed =
    result.context.mode === "changes"
      ? `${pluralize(result.context.changedFiles, "file")} changed${result.context.base ? ` vs ${result.context.base}` : ""}`
      : `${pluralize(result.context.files, "file")} (full audit)`;
  out.push(
    ` ${s.bold("groundrule check")} ${s.dim(`· ${pluralize(result.summary.standards, "standard")} · ${changed}`)}`,
  );
  out.push("");

  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const warnings = result.diagnostics.filter((d) => d.severity === "warning");
  for (const d of errors)
    out.push(` ${s.red("✕")} ${s.red("Config error")}  ${formatDiagnostic(d)}`);
  for (const d of warnings) out.push(` ${s.yellow("!")} ${formatDiagnostic(d)}`);
  if (errors.length || warnings.length) out.push("");

  const visible = result.findings.filter(
    (f) => f.status !== "not-evaluable" && (options.verbose || (!f.suppressedBy && f.isNew)),
  );
  const grouped = new Map<string, Finding[]>();
  for (const finding of visible) {
    const list = grouped.get(finding.standardId) ?? [];
    list.push(finding);
    grouped.set(finding.standardId, list);
  }

  for (const [id, findings] of grouped) {
    const loaded = byId.get(id);
    const first = findings[0];
    if (!first) continue;
    const blocking = findings.some((f) => result.blocking.has(f.fingerprint));
    const icon = blocking ? s.red("✕") : first.status === "concern" ? s.blue("?") : s.yellow("⚠");
    const severity = blocking ? s.red(first.severity.toUpperCase()) : s.yellow(first.severity);
    out.push(` ${icon} ${s.bold(id)}  ${loaded?.standard.metadata.title ?? ""}`);
    out.push(`   ${severity} ${s.dim(`· ${sourceLabel(first)}`)}`);

    // Signal over noise: a handful of locations per standard unless --verbose.
    const shown = options.verbose ? findings : findings.slice(0, MAX_PER_STANDARD);
    for (const f of shown) {
      const tags = [
        f.status === "concern" ? s.blue("possible") : "",
        !f.isNew ? s.dim("legacy") : "",
        f.suppressedBy ? s.dim(`excepted by ${f.suppressedBy}`) : "",
      ].filter(Boolean);
      out.push(`   ${s.dim(locationLabel(f.location))}${tags.length ? `  ${tags.join(" ")}` : ""}`);
      out.push(`     ${f.message}`);
      for (const line of f.evidence.slice(0, 2)) out.push(`     ${s.dim(line)}`);
    }
    if (shown.length < findings.length) {
      const rest = findings.slice(shown.length);
      const files = new Set(rest.map((f) => f.location?.file).filter(Boolean)).size;
      out.push(
        `   ${s.dim(`… ${rest.length} more in ${pluralize(files, "file")} (show all with --verbose)`)}`,
      );
    }

    const fix = findings.find((f) => f.remediation)?.remediation;
    if (fix) out.push(`   ${s.green("→")} ${oneLine(fix)}`);
    out.push(`   ${s.dim(`→ groundrule explain ${id}`)}`);
    out.push("");
  }

  const hiddenLegacy = options.verbose
    ? 0
    : result.findings.filter((f) => !f.isNew && !f.suppressedBy && f.status !== "not-evaluable")
        .length;
  const hiddenSuppressed = options.verbose
    ? 0
    : result.findings.filter((f) => f.suppressedBy).length;
  if (hiddenLegacy || hiddenSuppressed) {
    const parts = [
      hiddenLegacy
        ? `${pluralize(hiddenLegacy, "legacy finding")} not introduced by this change`
        : "",
      hiddenSuppressed ? `${pluralize(hiddenSuppressed, "finding")} covered by exceptions` : "",
    ].filter(Boolean);
    out.push(` ${s.dim(`○ ${parts.join(" · ")} (show with --verbose)`)}`);
    out.push("");
  }

  const notEvaluated = result.outcomes.filter(
    (o) =>
      o.reason &&
      (o.status === "not-evaluable" ||
        o.status === "failed" ||
        o.status === "passed" ||
        o.status === "warned"),
  );
  if (notEvaluated.length > 0) {
    for (const o of notEvaluated) {
      const what = o.status === "not-evaluable" ? "not evaluated" : "partly evaluated";
      out.push(` ${s.dim(`– ${o.id} ${what}: ${o.reason}`)}`);
    }
    out.push("");
  }

  out.push(` ${summaryLine(input, s)}`);
  out.push("");
  return out.join("\n");
}

function summaryLine(input: ReportInput, s: Style): string {
  const { summary, context } = input.result;
  const parts = [
    summary.passed ? s.green(`✓ ${summary.passed} passed`) : "",
    summary.failed ? s.red(`✕ ${summary.failed} failed`) : "",
    summary.warned
      ? s.yellow(`⚠ ${summary.warned} ${summary.warned === 1 ? "warning" : "warnings"}`)
      : "",
    summary.notEvaluable ? s.dim(`– ${summary.notEvaluable} not evaluated`) : "",
    summary.guidance ? s.dim(`◇ ${summary.guidance} guidance`) : "",
    summary.skipped ? s.dim(`${summary.skipped} not applicable`) : "",
  ].filter(Boolean);
  const verdict = input.result.failed ? s.red(s.bold("Failed")) : s.green(s.bold("Passed"));
  return `${verdict}  ${parts.join("  ")}  ${s.dim(`· ${(context.durationMs / 1000).toFixed(1)}s`)}`;
}

function sourceLabel(f: Finding): string {
  const source = SOURCE_LABEL[f.source];
  return f.source === "ai"
    ? `${source} · ${f.confidence} confidence`
    : `${source} (${f.evaluator})`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
