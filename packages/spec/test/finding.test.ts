import { describe, expect, it } from "vitest";
import { Finding, GroundruleDocument } from "../src/index.js";

describe("Finding", () => {
  it("accepts a complete AI finding", () => {
    const parsed = Finding.parse({
      standardId: "AUTH-017",
      standardVersion: 4,
      evaluator: "llm",
      source: "ai",
      status: "violation",
      severity: "blocker",
      confidence: "high",
      location: { file: "src/ClaimController.java", startLine: 42, endLine: 58 },
      message: "POST /claims/{id}/approve has no authorization check.",
      evidence: ["ClaimService.approve() is called without AuthorizationService.authorize()"],
      isNew: true,
      fingerprint: "a1b2c3",
    });
    expect(parsed.source).toBe("ai");
  });
});

describe("GroundruleDocument", () => {
  it("dispatches on kind", () => {
    const doc = GroundruleDocument.parse({ apiVersion: "groundrule.dev/v1alpha1", kind: "Config" });
    expect(doc.kind).toBe("Config");
  });

  it("rejects unknown kinds", () => {
    expect(
      GroundruleDocument.safeParse({ apiVersion: "groundrule.dev/v1alpha1", kind: "Policy" })
        .success,
    ).toBe(false);
  });
});
