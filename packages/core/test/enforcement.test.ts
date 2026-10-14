import { describe, expect, it } from "vitest";
import { cannotFail, enforcementOf } from "../src/index.js";

describe("enforcement of a standard", () => {
  it("is checked with any deterministic or static-analysis check, even alongside AI", () => {
    expect(enforcementOf(["regex"])).toBe("checked");
    expect(enforcementOf(["semgrep"])).toBe("checked");
    expect(enforcementOf(["llm", "files"])).toBe("checked");
    expect(enforcementOf(["my-plugin"])).toBe("checked");
  });

  it("is AI review with only AI checks, and guidance with none", () => {
    expect(enforcementOf(["llm"])).toBe("ai-review");
    expect(enforcementOf([])).toBe("guidance");
  });

  it("flags blocker and warning rules that can't fail a change", () => {
    expect(cannotFail("blocker", [])).toBe(true);
    expect(cannotFail("warning", ["llm"])).toBe(true);
    expect(cannotFail("blocker", ["regex"])).toBe(false);
    expect(cannotFail("advisory", [])).toBe(false);
    expect(cannotFail("info", [])).toBe(false);
  });
});
