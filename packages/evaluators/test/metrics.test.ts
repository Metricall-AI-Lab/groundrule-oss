// The metrics evaluator (ADR 0013): file lines, function lines, parameters and nesting over
// tolerant function detection in six languages.
import { describe, expect, it } from "vitest";
import { measureFunctions, metricsEvaluator } from "../src/index.js";
import { fakeContext, run } from "./helpers.js";

describe("measuring functions", () => {
  it("finds TypeScript declarations, methods and arrows, with parameters and nesting", () => {
    const text = `// function nope() {
export async function placeOrder(order: Order, { retry = 1 }: Options, clock: Clock) {
  if (order.lines.length) {
    for (const line of order.lines) {
      if (line.qty > 0) { total += line.qty; }
    }
  }
  const s = "{ not a brace }";
  return total;
}
const handler = async (req, res) => {
  res.send("}");
};
class Repo {
  private find(id: string): Promise<Row> {
    return this.db.get(id);
  }
}
`;
    expect(measureFunctions("src/a.ts", text)).toEqual([
      { name: "placeOrder", line: 2, lines: 9, parameters: 3, nesting: 3 },
      { name: "handler", line: 11, lines: 3, parameters: 2, nesting: 0 },
      { name: "find", line: 15, lines: 3, parameters: 1, nesting: 0 },
    ]);
  });

  it("reads Python by indentation, not counting self", () => {
    const text = `class Orders:
    def place(self, order, clock,
              retries=1):
        if order:
            for line in order.lines:
                if line.qty:
                    pass
        return 1

    async def other(cls):
        pass


def top(a, b, *args, **kwargs):
    """ {not a brace} """
    return a
`;
    expect(measureFunctions("app/a.py", text)).toEqual([
      { name: "place", line: 2, lines: 7, parameters: 3, nesting: 3 },
      { name: "other", line: 10, lines: 2, parameters: 0, nesting: 0 },
      { name: "top", line: 14, lines: 3, parameters: 4, nesting: 0 },
    ]);
  });

  it("reads Java, Kotlin and Go methods", () => {
    expect(
      measureFunctions(
        "A.java",
        `public class A {\n  public List<Order> find(String id, Map<String, Integer> opts) throws IOException {\n    if (id != null) {\n      return List.of();\n    }\n    return null;\n  }\n}\n`,
      ),
    ).toEqual([{ name: "find", line: 2, lines: 6, parameters: 2, nesting: 1 }]);
    expect(
      measureFunctions(
        "A.kt",
        `fun total(lines: List<Line>, tax: Int = 0): Int {\n  return 1\n}\n`,
      ),
    ).toEqual([{ name: "total", line: 1, lines: 3, parameters: 2, nesting: 0 }]);
    expect(
      measureFunctions(
        "a.go",
        `package a\n\nfunc (s *Service) Place(ctx context.Context, o Order, retries, max int) error {\n\tif o.ID == "" {\n\t\treturn nil\n\t}\n\treturn nil\n}\n`,
      ),
    ).toEqual([{ name: "Place", line: 3, lines: 6, parameters: 4, nesting: 1 }]);
  });
});

describe("metrics", () => {
  it("reports files and functions over their limits, with the number and the limit", async () => {
    const long = Array.from({ length: 12 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const files = {
      "src/big.ts": `${long}\n`,
      "src/fn.ts": `export function wide(a, b, c) {\n  if (a) {\n    if (b) {\n      if (c) { return 1; }\n    }\n  }\n  return 0;\n}\n`,
    };
    const findings = await run(
      metricsEvaluator,
      { maxFileLines: 10, maxFunctionLines: 5, maxParameters: 2, maxNesting: 2 },
      fakeContext(files),
    );
    expect(
      findings.map((f) => [f.location?.file, f.location?.startLine, f.confidence, f.message]),
    ).toEqual([
      ["src/big.ts", 1, "certain", "src/big.ts is 12 lines, over the limit of 10"],
      ["src/fn.ts", 1, "high", "wide() in src/fn.ts is 8 lines, over the limit of 5"],
      ["src/fn.ts", 1, "high", "wide() in src/fn.ts takes 3 parameters, over the limit of 2"],
      ["src/fn.ts", 1, "high", "wide() in src/fn.ts nests 3 levels deep, over the limit of 2"],
    ]);
  });

  it("validates its options", () => {
    expect(() => metricsEvaluator.optionsSchema.parse({ from: ["src/**"] })).toThrow(/limit/);
    expect(metricsEvaluator.optionsSchema.parse({ maxNesting: 0 })).toBeTruthy();
  });
});
