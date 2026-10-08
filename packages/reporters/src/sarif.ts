import { displayPath } from "@groundrule/core";
import type { Severity } from "@groundrule/spec";
import { type ReportInput, standardsById } from "./input.js";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  blocker: "error",
  warning: "warning",
  advisory: "note",
  info: "note",
};

/** SARIF 2.1.0 for GitHub code scanning and other SARIF consumers. */
export function renderSarif(input: ReportInput): string {
  const { result } = input;
  const byId = standardsById(input);
  const reported = result.findings.filter(
    (f) => f.status === "violation" || f.status === "concern",
  );
  const ruleIds = [...new Set(reported.map((f) => f.standardId))].sort();

  const rules = ruleIds.map((id) => {
    const loaded = byId.get(id);
    const spec = loaded?.standard.spec;
    const help = [
      spec?.requirement,
      spec?.intent && `Why: ${spec.intent}`,
      spec?.remediation && `Fix: ${spec.remediation}`,
    ]
      .filter(Boolean)
      .map((t) => String(t).trim())
      .join("\n\n");
    return {
      id,
      name: id.replace(/-/g, ""),
      shortDescription: { text: loaded?.standard.metadata.title ?? id },
      fullDescription: { text: spec?.requirement.trim() ?? id },
      help: { text: help || id },
      defaultConfiguration: { level: spec ? LEVEL[spec.severity] : "warning" },
      properties: {
        tags: [
          "groundrule",
          ...(loaded?.standard.metadata.category ? [loaded.standard.metadata.category] : []),
        ],
        ...(loaded?.standard.metadata.owner ? { owner: loaded.standard.metadata.owner } : {}),
      },
    };
  });

  const results = reported.map((f) => {
    const loaded = byId.get(f.standardId);
    // SARIF consumers need a location; repository-level findings point at the standard's file.
    const uri =
      f.location?.file ??
      (loaded ? displayPath(result.context.root, loaded.file) : ".groundrule/config.yaml");
    const region = f.location
      ? {
          startLine: f.location.startLine,
          ...(f.location.endLine ? { endLine: f.location.endLine } : {}),
        }
      : { startLine: 1 };
    return {
      ruleId: f.standardId,
      ruleIndex: ruleIds.indexOf(f.standardId),
      level: f.status === "concern" ? "note" : LEVEL[f.severity],
      message: {
        text: [f.message, f.remediation && `Fix: ${f.remediation}`].filter(Boolean).join("\n"),
      },
      locations: [
        { physicalLocation: { artifactLocation: { uri, uriBaseId: "%SRCROOT%" }, region } },
      ],
      partialFingerprints: { "groundrule/v1": f.fingerprint },
      ...(f.suppressedBy
        ? {
            suppressions: [
              { kind: "external", justification: `Groundrule exception ${f.suppressedBy}` },
            ],
          }
        : {}),
      properties: {
        source: f.source,
        evaluator: f.evaluator,
        confidence: f.confidence,
        isNew: f.isNew,
        blocking: result.blocking.has(f.fingerprint),
        standardVersion: f.standardVersion,
      },
    };
  });

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Groundrule",
            informationUri: "https://groundrule.dev",
            semanticVersion: input.version,
            rules,
          },
        },
        originalUriBaseIds: { "%SRCROOT%": { uri: "file:///" } },
        results,
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
