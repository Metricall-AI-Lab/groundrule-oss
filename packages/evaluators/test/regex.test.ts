import { describe, expect, it } from "vitest";
import { regexEvaluator } from "../src/index.js";
import { fakeContext, run } from "./helpers.js";

describe("regex", () => {
  const ctx = fakeContext({
    "src/a.ts": "const a = 1;\nconsole.log(a);\nconsole.log(a);\n",
    "src/b.test.ts": "console.log('test');\n",
    "bin/blob": "console.log\0binary",
  });

  it("reports each forbidden match with its line", async () => {
    const findings = await run(
      regexEvaluator,
      { pattern: "console\\.log\\(", exclude: ["**/*.test.ts"] },
      ctx,
    );
    expect(findings.map((f) => [f.location?.file, f.location?.startLine])).toEqual([
      ["src/a.ts", 2],
      ["src/a.ts", 3],
    ]);
    expect(findings[0]?.evidence).toEqual(["2: console.log(a);"]);
  });

  it("gives identical lines distinct, stable fingerprints", async () => {
    const findings = await run(
      regexEvaluator,
      { pattern: "console\\.log\\(", include: ["src/a.ts"] },
      ctx,
    );
    expect(findings.map((f) => f.snippet)).toEqual(["console.log(a);#1", "console.log(a);#2"]);
  });

  it("locates matches at their first non-whitespace line", async () => {
    const java = fakeContext({ "A.java": "class A {\n\n  private Foo foo;\n}\n" });
    const findings = await run(regexEvaluator, { pattern: "^\\s*private Foo" }, java);
    expect(findings.map((f) => f.location?.startLine)).toEqual([3]);
  });

  it("skips binary files", async () => {
    const findings = await run(regexEvaluator, { pattern: "console", include: ["bin/**"] }, ctx);
    expect(findings).toEqual([]);
  });

  it("require mode reports files without the pattern", async () => {
    const findings = await run(
      regexEvaluator,
      { pattern: "^const", mode: "require", include: ["src/**"] },
      ctx,
    );
    expect(findings.map((f) => f.location?.file)).toEqual(["src/b.test.ts"]);
  });

  it("supports case-insensitive flags and caps matches per file", async () => {
    const many = fakeContext({ "a.txt": "TODO\ntodo\nToDo\n" });
    expect(await run(regexEvaluator, { pattern: "todo", flags: "i" }, many)).toHaveLength(3);
    expect(
      await run(regexEvaluator, { pattern: "todo", flags: "i", maxMatchesPerFile: 2 }, many),
    ).toHaveLength(2);
  });

  it("rejects invalid patterns and flags", () => {
    expect(regexEvaluator.optionsSchema.safeParse({ pattern: "(" }).success).toBe(false);
    expect(regexEvaluator.optionsSchema.safeParse({ pattern: "a", flags: "g" }).success).toBe(
      false,
    );
  });
});
