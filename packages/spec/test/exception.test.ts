import { describe, expect, it } from "vitest";
import { API_VERSION, ExceptionList, isExceptionActive } from "../src/index.js";

describe("ExceptionList", () => {
  it("parses exceptions and defaults paths to everything", () => {
    const parsed = ExceptionList.parse({
      apiVersion: API_VERSION,
      kind: "ExceptionList",
      spec: {
        exceptions: [
          { id: "EX-1042", standard: "DEP-011", reason: "Migration in Q4", expires: "2027-01-31" },
        ],
      },
    });
    expect(parsed.spec.exceptions[0]?.paths).toEqual(["**"]);
  });

  it("requires a valid expiry date", () => {
    const result = ExceptionList.safeParse({
      apiVersion: API_VERSION,
      kind: "ExceptionList",
      spec: { exceptions: [{ id: "EX-1", standard: "DEP-011", reason: "x", expires: "soon" }] },
    });
    expect(result.success).toBe(false);
  });
});

describe("isExceptionActive", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("is active through the expiry date and inactive after", () => {
    expect(isExceptionActive({ expires: "2026-10-07" }, now)).toBe(true);
    expect(isExceptionActive({ expires: "2026-10-06" }, now)).toBe(false);
  });
});
