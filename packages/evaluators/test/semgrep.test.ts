import { afterEach, describe, expect, it } from "vitest";
import { semgrepEvaluator, semgrepRuntime } from "../src/index.js";
import { fakeContext, run } from "./helpers.js";

const originalRun = semgrepRuntime.run;
afterEach(() => {
  semgrepRuntime.run = originalRun;
});

describe("semgrep", () => {
  it("maps Semgrep JSON results to findings", async () => {
    let args: string[] = [];
    semgrepRuntime.run = async (a) => {
      args = a;
      return JSON.stringify({
        results: [
          {
            check_id: "auth-017",
            path: "src/Api.java",
            start: { line: 10 },
            end: { line: 12 },
            extra: { message: "Endpoint lacks authorization", lines: "@PostMapping(...)" },
          },
        ],
        errors: [],
      });
    };
    const findings = await run(
      semgrepEvaluator,
      { rules: "p/java" },
      fakeContext({ "src/Api.java": "" }),
    );
    expect(args).toContain("--metrics=off");
    expect(args.slice(-2)).toEqual(["--", "src/Api.java"]);
    expect(findings).toEqual([
      expect.objectContaining({
        status: "violation",
        message: "Endpoint lacks authorization",
        location: { file: "src/Api.java", startLine: 10, endLine: 12 },
      }),
    ]);
  });

  it("reads code from the file when Semgrep redacts it, keeping fingerprints distinct", async () => {
    semgrepRuntime.run = async () =>
      JSON.stringify({
        results: [
          {
            check_id: "r",
            path: "A.java",
            start: { line: 2 },
            end: { line: 2 },
            extra: { message: "m", lines: "requires login" },
          },
          {
            check_id: "r",
            path: "A.java",
            start: { line: 3 },
            end: { line: 3 },
            extra: { message: "m", lines: "requires login" },
          },
        ],
      });
    const ctx = fakeContext({ "A.java": "class A {\n  void a() {}\n  void b() {}\n}\n" });
    const findings = await run(semgrepEvaluator, { rules: "p/java" }, ctx);
    expect(findings.map((f) => f.evidence?.[1])).toEqual(["2: void a() {}", "3: void b() {}"]);
    expect(new Set(findings.map((f) => f.snippet)).size).toBe(2);
  });

  it("fails clearly when local rules are missing", async () => {
    await expect(
      run(semgrepEvaluator, { rules: "rules/missing.yaml" }, fakeContext({ "a.java": "" })),
    ).rejects.toThrow(/rules not found/);
  });

  it("does nothing without target files", async () => {
    expect(await run(semgrepEvaluator, { rules: "p/java" }, fakeContext({}))).toEqual([]);
  });

  it("explains how to install Semgrep when it is missing", async () => {
    const binary = semgrepRuntime.binary;
    semgrepRuntime.binary = "semgrep-definitely-not-installed";
    semgrepRuntime.resetAvailability();
    expect(await semgrepEvaluator.supports?.(fakeContext({}))).toMatch(/brew install semgrep/);
    semgrepRuntime.binary = binary;
    semgrepRuntime.resetAvailability();
  });
});
