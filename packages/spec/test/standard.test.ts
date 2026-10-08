import { describe, expect, it } from "vitest";
import { API_VERSION, compareSeverity, Standard } from "../src/index.js";

const minimal = {
  apiVersion: API_VERSION,
  kind: "Standard",
  metadata: { id: "AUTH-017", title: "Authorization at the service boundary", type: "requirement" },
  spec: { severity: "blocker", requirement: "Every mutating operation checks authorization." },
};

describe("Standard", () => {
  it("accepts a minimal standard and fills defaults", () => {
    const parsed = Standard.parse(minimal);
    expect(parsed.metadata.status).toBe("active");
    expect(parsed.metadata.version).toBe(1);
    expect(parsed.spec.scope).toEqual({});
    expect(parsed.spec.checks).toEqual([]);
    expect(parsed.spec.agent).toEqual({ instruction: true });
  });

  it.each(["AUTH-017", "DATA-21", "AI-3", "CLAIMS-API-001"])("accepts id %s", (id) => {
    expect(Standard.safeParse({ ...minimal, metadata: { ...minimal.metadata, id } }).success).toBe(
      true,
    );
  });

  it.each(["auth-017", "AUTH", "AUTH-", "AUTH_017", "017-AUTH", "AUTH-01A"])(
    "rejects id %s",
    (id) => {
      expect(
        Standard.safeParse({ ...minimal, metadata: { ...minimal.metadata, id } }).success,
      ).toBe(false);
    },
  );

  it("rejects unknown keys so typos surface early", () => {
    const result = Standard.safeParse({
      ...minimal,
      spec: { ...minimal.spec, severty: "warning" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects the wrong apiVersion", () => {
    expect(Standard.safeParse({ ...minimal, apiVersion: "groundrule.dev/v2" }).success).toBe(false);
  });

  it("keeps evaluator-specific options on checks", () => {
    const parsed = Standard.parse({
      ...minimal,
      spec: {
        ...minimal.spec,
        checks: [{ evaluator: "dependencies", forbid: ["axios"], minConfidence: "high" }],
      },
    });
    expect(parsed.spec.checks[0]).toEqual({
      evaluator: "dependencies",
      forbid: ["axios"],
      minConfidence: "high",
    });
  });

  it("rejects a check without an evaluator", () => {
    const result = Standard.safeParse({
      ...minimal,
      spec: { ...minimal.spec, checks: [{ forbid: ["axios"] }] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts string and object examples", () => {
    const parsed = Standard.parse({
      ...minimal,
      spec: {
        ...minimal.spec,
        examples: {
          approved: ["@PreAuthorize(...)", { code: "authz.check(user, claim)", language: "java" }],
        },
      },
    });
    expect(parsed.spec.examples?.approved).toHaveLength(2);
  });
});

describe("compareSeverity", () => {
  it("orders info < advisory < warning < blocker", () => {
    expect(compareSeverity("info", "advisory")).toBeLessThan(0);
    expect(compareSeverity("blocker", "warning")).toBeGreaterThan(0);
    expect(compareSeverity("warning", "warning")).toBe(0);
  });
});
