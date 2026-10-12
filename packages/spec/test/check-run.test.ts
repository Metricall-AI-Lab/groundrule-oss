// CheckRun (RFC 0005): the contract between `groundrule check --upload` and the platform.
import { describe, expect, it } from "vitest";
import { CheckRun } from "../src/index.js";

const RUN = {
  apiVersion: "groundrule.dev/v1alpha1",
  kind: "CheckRun",
  metadata: {
    generatedAt: "2026-10-12T10:00:00Z",
    cliVersion: "0.2.0",
    durationMs: 420,
    snippets: true,
  },
  repository: { name: "acme/payments-api", commit: "a".repeat(40), branch: "fix/refunds" },
  pullRequest: {
    number: 42,
    title: "Add refunds",
    url: "https://github.com/acme/payments-api/pull/42",
    headRef: "fix/refunds",
    baseRef: "main",
    author: "octocat",
  },
  mode: "changes",
  base: "origin/main",
  files: 812,
  changedFiles: 4,
  passed: false,
  failOn: "blocker",
  summary: {
    standards: 83,
    passed: 43,
    failed: 1,
    warned: 2,
    notEvaluable: 0,
    guidance: 1,
    skipped: 36,
    violations: 4,
    concerns: 0,
    suppressed: 0,
    legacy: 0,
    blocking: 1,
  },
  outcomes: [
    {
      id: "ACME-001",
      title: "Represent money as integer cents",
      severity: "blocker",
      status: "failed",
      violations: 1,
      concerns: 0,
    },
  ],
  findings: [
    {
      standardId: "ACME-001",
      severity: "blocker",
      status: "violation",
      source: "deterministic",
      blocking: true,
      isNew: true,
      file: "src/refunds.ts",
      line: 6,
      message: "Money handled as a float; use integer cents",
      snippet: "const total = amount * 1.0;",
    },
  ],
  omittedFindings: 0,
};

describe("CheckRun", () => {
  it("accepts the RFC's example, with or without a pull request", () => {
    expect(CheckRun.safeParse(RUN).success).toBe(true);
    const { pullRequest: _, ...branchRun } = RUN;
    expect(CheckRun.safeParse(branchRun).success).toBe(true);
  });

  it("rejects what it shouldn't carry", () => {
    const bad = (patch: object) => CheckRun.safeParse({ ...RUN, ...patch }).success;
    expect(bad({ pullRequest: { ...RUN.pullRequest, url: "http://github.com/x/pull/1" } })).toBe(
      false,
    );
    expect(bad({ pullRequest: { number: 0 } })).toBe(false);
    expect(bad({ repository: { ...RUN.repository, commit: "main" } })).toBe(false);
    expect(bad({ findings: Array.from({ length: 501 }, () => RUN.findings[0]) })).toBe(false);
    expect(bad({ findings: [{ ...RUN.findings[0], snippet: "x".repeat(201) }] })).toBe(false);
    expect(bad({ findings: [{ ...RUN.findings[0], status: "pass" }] })).toBe(false);
    expect(bad({ diff: "--- a/src/refunds.ts" })).toBe(false);
  });
});
