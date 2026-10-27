// The layout evaluator (ADR 0012): names, places and companions, over file names only.
import type { EvaluatorFinding } from "@groundrule/core";
import { describe, expect, it } from "vitest";
import { layoutEvaluator } from "../src/index.js";
import { fakeContext, run } from "./helpers.js";

const summarize = (findings: readonly EvaluatorFinding[]) =>
  findings.map((f) => `${f.location?.file} ${f.evidence?.[0]}`).sort();

const repo = {
  "src/api/orders.controller.ts": "",
  "src/api/orders.controller.test.ts": "",
  "src/domain/OrderService.ts": "",
  "src/domain/order-service.ts": "",
  "tests/domain/order-service.test.ts": "",
  "src/jobs/nightly.controller.ts": "",
  "README.md": "",
};

describe("layout", () => {
  it("checks names by glob or regular expression", async () => {
    const byGlob = await run(
      layoutEvaluator,
      { from: ["src/api/**"], name: "*.controller.ts" },
      fakeContext(repo),
    );
    expect(summarize(byGlob)).toEqual([
      'src/api/orders.controller.test.ts src/api/orders.controller.test.ts: the name "orders.controller.test.ts" does not match *.controller.ts',
    ]);
    const byRegex = await run(
      layoutEvaluator,
      { from: ["src/**/*.ts"], namePattern: "^[a-z0-9.-]+\\.ts$", message: "Use kebab-case." },
      fakeContext(repo),
    );
    expect(byRegex.map((f) => [f.location?.file, f.message])).toEqual([
      ["src/domain/OrderService.ts", "Use kebab-case."],
    ]);
  });

  it("checks where a kind of file lives", async () => {
    const findings = await run(
      layoutEvaluator,
      {
        from: ["**/*.controller.ts"],
        place: ["src/api/**"],
        remediation: "Move it under src/api.",
      },
      fakeContext(repo),
    );
    expect(summarize(findings)).toEqual([
      "src/jobs/nightly.controller.ts src/jobs/nightly.controller.ts is not under src/api/**",
    ]);
    expect(findings[0]).toMatchObject({
      confidence: "certain",
      location: { file: "src/jobs/nightly.controller.ts", startLine: 1 },
      remediation: "Move it under src/api.",
    });
  });

  it("requires a companion, resolved against the whole repository", async () => {
    const findings = await run(
      layoutEvaluator,
      {
        from: ["src/**/*.ts"],
        companion: ["{dir}/{base}.test.ts", "tests/**/{base}.test.ts"],
      },
      // Only the source files are under check; their tests are found anyway.
      fakeContext(repo, {
        targetFiles: [
          "src/api/orders.controller.ts",
          "src/domain/order-service.ts",
          "src/domain/OrderService.ts",
        ],
      }),
    );
    expect(summarize(findings)).toEqual([
      "src/domain/OrderService.ts src/domain/OrderService.ts: none of src/domain/OrderService.test.ts, tests/**/OrderService.test.ts exists",
    ]);
  });

  it("skips excluded files", async () => {
    const findings = await run(
      layoutEvaluator,
      { from: ["src/**/*.ts"], exclude: ["**/*.test.ts"], companion: ["{dir}/{base}.test.ts"] },
      fakeContext({ "src/a.ts": "", "src/a.test.ts": "" }),
    );
    expect(findings).toEqual([]);
  });

  it("validates its options", () => {
    expect(() => layoutEvaluator.optionsSchema.parse({ from: ["a/**"] })).toThrow(/at least one/);
    expect(() => layoutEvaluator.optionsSchema.parse({ namePattern: "[" })).toThrow(
      /regular expression/,
    );
    expect(layoutEvaluator.optionsSchema.parse({ place: ["src/**"] })).toBeTruthy();
  });
});
