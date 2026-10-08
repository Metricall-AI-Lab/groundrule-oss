import {
  locationLabel,
  pluralize,
  type ReportInput,
  SOURCE_LABEL,
  standardsById,
} from "./input.js";

/** Comments and job summaries have size limits; the full list is one command away. */
const MAX_ROWS = 50;

/** Markdown for pull request comments and GitHub job summaries. */
export function renderMarkdown(input: ReportInput): string {
  const { result } = input;
  const byId = standardsById(input);
  const { summary } = result;
  const lines: string[] = [];

  const headline = result.failed
    ? `✕ ${pluralize(summary.failed, "standard")} failed`
    : summary.warned
      ? `⚠ Passed with ${pluralize(summary.warned, "warning")}`
      : "✓ All standards passed";
  lines.push(`### Groundrule · ${headline}`, "");

  const visible = result.findings.filter(
    (f) => f.status !== "not-evaluable" && !f.suppressedBy && f.isNew,
  );
  if (visible.length > 0) {
    lines.push("| | Standard | Finding | Where | Source |", "|---|---|---|---|---|");
    for (const f of visible.slice(0, MAX_ROWS)) {
      const icon = result.blocking.has(f.fingerprint) ? "✕" : f.status === "concern" ? "?" : "⚠";
      const title = byId.get(f.standardId)?.standard.metadata.title ?? "";
      const source = f.source === "ai" ? `AI · ${f.confidence}` : SOURCE_LABEL[f.source];
      lines.push(
        `| ${icon} | **${f.standardId}** ${escapeCell(title)} | ${escapeCell(f.message)}${f.remediation ? `<br>**Fix:** ${escapeCell(oneLine(f.remediation))}` : ""} | \`${locationLabel(f.location)}\` | ${source} |`,
      );
    }
    if (visible.length > MAX_ROWS)
      lines.push(
        `| | | _…and ${visible.length - MAX_ROWS} more. Run \`groundrule check\` locally for the full list._ | | |`,
      );
    lines.push("");
  }

  const legacy = result.findings.filter(
    (f) => !f.isNew && !f.suppressedBy && f.status !== "not-evaluable",
  ).length;
  const suppressed = result.findings.filter((f) => f.suppressedBy).length;
  const notes = [
    summary.passed ? `✓ ${summary.passed} passed` : "",
    summary.guidance ? `◇ ${summary.guidance} guidance` : "",
    summary.notEvaluable ? `– ${summary.notEvaluable} not evaluated` : "",
    summary.skipped ? `${summary.skipped} not applicable` : "",
    legacy ? `${pluralize(legacy, "legacy finding")}` : "",
    suppressed ? `${suppressed} covered by exceptions` : "",
  ].filter(Boolean);
  if (notes.length) lines.push(notes.join(" · "), "");

  const partial = result.outcomes.filter(
    (o) => o.reason && o.status !== "skipped" && o.status !== "guidance",
  );
  if (partial.length) {
    lines.push("<details><summary>Not fully evaluated</summary>", "");
    for (const o of partial) lines.push(`- **${o.id}**: ${escapeCell(o.reason ?? "")}`);
    lines.push("", "</details>", "");
  }
  lines.push(
    `<sub>Groundrule ${input.version} · run \`groundrule explain <ID>\` for details</sub>`,
    "",
  );
  return lines.join("\n");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
