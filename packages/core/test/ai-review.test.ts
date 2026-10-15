// AI review requests (RFC 0013): the changed lines of the files an llm rule names, with
// context, secrets redacted, within the per-run limits; nothing for rules at Teach or files
// outside the scope, and nothing at all without changes.
import { AiReviewRequests } from "@groundrule/spec";
import { describe, expect, it } from "vitest";
import { AI_REVIEW_LIMITS, collectAiReviewRequests, type LoadedStandard } from "../src/index.js";

const standard = (
  id: string,
  checks: Record<string, unknown>[],
  extra: { scope?: Record<string, unknown>; stage?: "teach" | "advise" | "enforce" } = {},
): LoadedStandard => ({
  standard: {
    apiVersion: "groundrule.dev/v1alpha1",
    kind: "Standard",
    metadata: { id, title: `${id} title`, type: "requirement", version: 2, status: "active" },
    spec: {
      severity: "warning",
      requirement: "Authorize every state-changing endpoint.",
      scope: extra.scope ?? {},
      checks,
      agent: {},
    },
  } as unknown as LoadedStandard["standard"],
  file: `/repo/.groundrule/standards/${id}.yaml`,
  origin: "local",
  disabled: false,
  ...(extra.stage ? { stage: extra.stage } : {}),
});

const repo = {
  root: "/repo",
  name: "acme/api",
  inGit: true,
  files: ["src/api/orders.ts", "src/api/users.ts", "src/lib/money.ts"],
  configPrefix: ".groundrule/",
  languages: ["typescript"],
  frameworks: [],
  tags: [],
};

const files: Record<string, string> = {
  "src/api/orders.ts": Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"),
  "src/api/users.ts": `const token = "AKIA${"IOSFODNN7EXAMPLE"}";\nexport const u = 1;\n`,
  "src/lib/money.ts": "export const cents = 1;\n",
};
const read = async (p: string) => {
  const text = files[p];
  if (text === undefined) throw new Error("missing");
  return text;
};

const question = "Does any new state-changing endpoint reach business logic without a check?";

describe("collectAiReviewRequests", () => {
  it("collects hunks with context for the files an llm rule names, and redacts secrets", async () => {
    const out = await collectAiReviewRequests({
      standards: [
        standard("AUTH-017", [{ evaluator: "llm", question, minConfidence: "high" }], {
          scope: { paths: ["src/api/**"] },
        }),
        standard("PAY-001", [{ evaluator: "regex", pattern: "x" }]),
        standard("DOC-001", [{ evaluator: "llm", question }], { stage: "teach" }),
      ],
      repo,
      changes: [
        {
          path: "src/api/orders.ts",
          status: "modified",
          changedLines: [
            { start: 10, end: 11 },
            { start: 13, end: 13 },
            { start: 28, end: 30 },
          ],
        },
        { path: "src/api/users.ts", status: "added", changedLines: [{ start: 1, end: 2 }] },
        { path: "src/lib/money.ts", status: "modified", changedLines: [{ start: 1, end: 1 }] },
        { path: "src/api/gone.ts", status: "deleted", changedLines: [] },
      ],
      readFile: read,
      cliVersion: "0.18.0",
      now: new Date("2026-10-17T00:00:00Z"),
    });
    expect(AiReviewRequests.parse(out)).toEqual(out);
    expect(out.requests.map((r) => [r.standardId, r.file])).toEqual([
      ["AUTH-017", "src/api/orders.ts"],
      ["AUTH-017", "src/api/users.ts"],
    ]);
    const orders = out.requests[0];
    expect(orders).toMatchObject({
      standardVersion: 2,
      title: "AUTH-017 title",
      severity: "warning",
      question,
      minConfidence: "high",
      language: "typescript",
    });
    // 10–11 and 13 merge with their context into one hunk; 28–30 is clipped to the file.
    expect(orders?.hunks.map((h) => [h.startLine, h.lines.length])).toEqual([
      [7, 10],
      [25, 6],
    ]);
    expect(orders?.hunks[0]?.lines[0]).toBe("line 7");
    expect(out.requests[1]?.hunks[0]?.lines[0]).toContain("[redacted]");
    expect(JSON.stringify(out)).not.toContain("AKIA");
    expect(out.skipped).toEqual({ files: 0, standards: [] });
  });

  it("stops at the per-run limits and says which rules were cut; nothing without changes", async () => {
    const big: Record<string, string> = {};
    const changes = [];
    for (let i = 0; i < AI_REVIEW_LIMITS.files + 2; i++) {
      big[`src/api/f${i}.ts`] = "a\nb\nc\n";
      changes.push({
        path: `src/api/f${i}.ts`,
        status: "modified" as const,
        changedLines: [{ start: 1, end: 1 }],
      });
    }
    big["src/api/huge.ts"] = Array.from({ length: 1_000 }, () => "x").join("\n");
    changes.push({
      path: "src/api/huge.ts",
      status: "modified" as const,
      changedLines: [{ start: 1, end: 1_000 }],
    });
    const standards = [standard("AUTH-017", [{ evaluator: "llm", question }])];
    const out = await collectAiReviewRequests({
      standards,
      repo: { ...repo, files: Object.keys(big) },
      changes,
      readFile: async (p) => big[p] ?? "",
      cliVersion: "0.18.0",
    });
    expect(out.requests).toHaveLength(AI_REVIEW_LIMITS.files);
    expect(out.skipped).toEqual({ files: 3, standards: ["AUTH-017"] });
    const none = await collectAiReviewRequests({
      standards,
      repo,
      changes: undefined,
      readFile: read,
      cliVersion: "0.18.0",
    });
    expect(none.requests).toEqual([]);
  });
});
