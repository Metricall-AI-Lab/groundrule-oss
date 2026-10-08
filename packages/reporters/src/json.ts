import { displayPath } from "@groundrule/core";
import type { ReportInput } from "./input.js";

/** Stable machine-readable output. Bump `schemaVersion` on breaking changes. */
export function renderJson(input: ReportInput): string {
  const { result } = input;
  const report = {
    schemaVersion: 1,
    tool: { name: "groundrule", version: input.version },
    passed: !result.failed,
    context: { ...result.context, root: undefined },
    summary: result.summary,
    outcomes: result.outcomes,
    findings: result.findings.map((f) => ({ ...f, blocking: result.blocking.has(f.fingerprint) })),
    diagnostics: result.diagnostics.map((d) => ({
      ...d,
      file: displayPath(result.context.root, d.file),
    })),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
