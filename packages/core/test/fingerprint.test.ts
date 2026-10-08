import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../src/index.js";

describe("computeFingerprint", () => {
  const base = { standardId: "DATA-021", evaluator: "semgrep", file: "src/Repo.java" };

  it("ignores whitespace changes in the snippet", () => {
    expect(computeFingerprint({ ...base, snippet: "repo.findById(id)" })).toBe(
      computeFingerprint({ ...base, snippet: "  repo.findById( id)".replace("( ", "(") }),
    );
    expect(computeFingerprint({ ...base, snippet: "a\n  b" })).toBe(
      computeFingerprint({ ...base, snippet: "a b" }),
    );
  });

  it("differs across standards, files, and snippets", () => {
    const a = computeFingerprint({ ...base, snippet: "x" });
    expect(computeFingerprint({ ...base, standardId: "DATA-022", snippet: "x" })).not.toBe(a);
    expect(computeFingerprint({ ...base, file: "other.java", snippet: "x" })).not.toBe(a);
    expect(computeFingerprint({ ...base, snippet: "y" })).not.toBe(a);
  });
});
