import { describe, expect, it } from "vitest";
import { changeSetEvaluator } from "../src/index.js";
import { change, fakeContext, run } from "./helpers.js";

const options = {
  when: { changed: ["src/**/entity/**/*.java"] },
  require: { added: ["db/migration/V*__*.sql"] },
};

describe("change-set", () => {
  it("needs a change set", async () => {
    expect(await changeSetEvaluator.supports?.(fakeContext({}))).toMatch(/Needs a change/);
  });

  it("passes when the change does not touch trigger files", async () => {
    const ctx = fakeContext({}, { changes: [change("src/main/web/Controller.java")] });
    expect(await run(changeSetEvaluator, options, ctx)).toEqual([]);
  });

  it("flags an entity change without a migration, at the first changed line", async () => {
    const ctx = fakeContext(
      {},
      { changes: [change("src/main/entity/Claim.java", "modified", [[12, 14]])] },
    );
    const [finding] = await run(changeSetEvaluator, options, ctx);
    expect(finding?.location).toEqual({ file: "src/main/entity/Claim.java", startLine: 12 });
    expect(finding?.message).toBe("This change needs a new db/migration/V*__*.sql");
  });

  it("passes when a migration is added", async () => {
    const ctx = fakeContext(
      {},
      {
        changes: [
          change("src/main/entity/Claim.java"),
          change("db/migration/V7__claim_status.sql", "added"),
        ],
      },
    );
    expect(await run(changeSetEvaluator, options, ctx)).toEqual([]);
  });

  it("does not count a modified migration as added", async () => {
    const ctx = fakeContext(
      {},
      {
        changes: [
          change("src/main/entity/Claim.java"),
          change("db/migration/V1__init.sql", "modified"),
        ],
      },
    );
    expect(await run(changeSetEvaluator, options, ctx)).toHaveLength(1);
  });
});
