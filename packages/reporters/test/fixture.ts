import type { LoadedStandard, RunResult } from "@groundrule/core";
import { API_VERSION, type Finding, Standard } from "@groundrule/spec";
import type { ReportInput } from "../src/index.js";

const std = (
  id: string,
  title: string,
  severity: "blocker" | "warning",
  extra: Record<string, unknown> = {},
): LoadedStandard => ({
  standard: Standard.parse({
    apiVersion: API_VERSION,
    kind: "Standard",
    metadata: { id, title, type: "requirement", owner: "team:platform", category: "security" },
    spec: { severity, requirement: `${title}.`, remediation: "Do the right thing.", ...extra },
  }),
  file: `/repo/.groundrule/standards/${id}.yaml`,
  origin: "local",
  disabled: false,
});

const finding = (overrides: Partial<Finding>): Finding => ({
  standardId: "AUTH-017",
  standardVersion: 4,
  evaluator: "semgrep",
  source: "static-analysis",
  status: "violation",
  severity: "blocker",
  confidence: "high",
  location: { file: "src/Api.java", startLine: 10, endLine: 11 },
  message: "Endpoint lacks authorization.",
  evidence: ['10: @PostMapping("/approve")'],
  remediation: "Add @PreAuthorize.",
  isNew: true,
  fingerprint: "fp-auth",
  ...overrides,
});

export function fixture(): ReportInput {
  const findings = [
    finding({}),
    finding({
      standardId: "DEP-008",
      standardVersion: 2,
      evaluator: "dependencies",
      source: "deterministic",
      severity: "warning",
      confidence: "certain",
      location: { file: "package.json", startLine: 5 },
      message: 'Forbidden dependency "axios"',
      evidence: [],
      remediation: "Use @acme/http-client instead.",
      fingerprint: "fp-dep",
    }),
    finding({
      standardId: "DEP-008",
      severity: "warning",
      isNew: false,
      fingerprint: "fp-legacy",
      location: { file: "old/package.json", startLine: 3 },
    }),
    finding({
      standardId: "DEP-008",
      severity: "warning",
      suppressedBy: "EX-1042",
      fingerprint: "fp-ex",
      location: { file: "billing/package.json", startLine: 4 },
    }),
  ];
  const result: RunResult = {
    findings,
    outcomes: [
      {
        id: "AI-003",
        title: "Do not invent internal APIs",
        severity: "warning",
        status: "guidance",
        reason: "Guidance",
        violations: 0,
        concerns: 0,
      },
      {
        id: "AUTH-017",
        title: "Authorization",
        severity: "blocker",
        status: "failed",
        reason: "AI checks arrive in Groundrule 0.2 (bring your own API key).",
        violations: 1,
        concerns: 0,
      },
      {
        id: "DEP-008",
        title: "HTTP client",
        severity: "warning",
        status: "warned",
        violations: 2,
        concerns: 0,
      },
      {
        id: "PROC-004",
        title: "Migrations",
        severity: "blocker",
        status: "passed",
        violations: 0,
        concerns: 0,
      },
    ],
    diagnostics: [],
    summary: {
      standards: 4,
      passed: 1,
      failed: 1,
      warned: 1,
      notEvaluable: 0,
      guidance: 1,
      skipped: 0,
      violations: 3,
      concerns: 0,
      suppressed: 1,
      legacy: 1,
      blocking: 1,
    },
    failed: true,
    blocking: new Set(["fp-auth"]),
    context: {
      root: "/repo",
      mode: "changes",
      base: "origin/main",
      files: 120,
      changedFiles: 3,
      languages: ["java"],
      frameworks: ["spring-boot"],
      durationMs: 420,
    },
  };
  return {
    result,
    standards: [
      std("AUTH-017", "Authorization checks must occur at the service boundary", "blocker", {
        intent: "Never trust the client.",
      }),
      std("DEP-008", "Use the platform HTTP client", "warning"),
    ],
    version: "0.1.0",
  };
}
