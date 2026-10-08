import { describe, expect, it } from "vitest";
import { filesEvaluator } from "../src/index.js";
import { fakeContext, run } from "./helpers.js";

describe("files", () => {
  const ctx = fakeContext({
    "README.md": "",
    ".env": "SECRET=1",
    ".env.example": "",
    "src/a.ts": "",
  });

  it("reports missing required files", async () => {
    const findings = await run(filesEvaluator, { require: ["README.md", "CODEOWNERS"] }, ctx);
    expect(findings.map((f) => f.message)).toEqual(["Required file is missing: CODEOWNERS"]);
  });

  it("supports requireAny", async () => {
    expect(await run(filesEvaluator, { requireAny: ["pnpm-lock.yaml", "README.md"] }, ctx)).toEqual(
      [],
    );
    expect(
      await run(filesEvaluator, { requireAny: ["pnpm-lock.yaml", "yarn.lock"] }, ctx),
    ).toHaveLength(1);
  });

  it("forbids files, honoring allow", async () => {
    const findings = await run(
      filesEvaluator,
      { forbid: ["**/.env*"], allow: ["**/.env.example"] },
      ctx,
    );
    expect(findings.map((f) => f.location?.file)).toEqual([".env"]);
  });

  it("only flags forbidden files among target files", async () => {
    const changed = fakeContext({ ".env": "", "src/a.ts": "" }, { targetFiles: ["src/a.ts"] });
    expect(await run(filesEvaluator, { forbid: ["**/.env"] }, changed)).toEqual([]);
  });

  it("requires at least one rule", () => {
    expect(filesEvaluator.optionsSchema.safeParse({}).success).toBe(false);
  });
});
