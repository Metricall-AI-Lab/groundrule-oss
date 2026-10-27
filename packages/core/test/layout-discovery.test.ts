// Layout discovery (RFC 0016): where a kind of file lives and which companion source files have.
import { describe, expect, it } from "vitest";
import { discoverLayout, kindOf } from "../src/index.js";

describe("kindOf", () => {
  it("reads dotted, underscore and CamelCase suffixes, not test or declaration files", () => {
    expect(kindOf("src/api/orders.controller.ts")).toBe("*.controller.ts");
    expect(kindOf("internal/http/orders_handler.go")).toBe("*_handler.go");
    expect(kindOf("src/main/java/com/acme/OrdersController.java")).toBe("*Controller.java");
    expect(kindOf("src/orders.test.ts")).toBeNull();
    expect(kindOf("src/types.d.ts")).toBeNull();
    expect(kindOf("src/orders.ts")).toBeNull();
    expect(kindOf("Controller.java")).toBeNull();
  });
});

describe("discoverLayout", () => {
  it("proposes where a kind of file lives, with the strays as violations", () => {
    const files = [
      "src/api/orders.controller.ts",
      "src/api/users.controller.ts",
      "src/api/v2/billing.controller.ts",
      "src/api/health.controller.ts",
      "src/jobs/nightly.controller.ts",
      "src/domain/order.ts",
    ];
    const [place] = discoverLayout(files);
    expect(place).toMatchObject({
      kind: "place",
      from: ["**/*.controller.ts"],
      place: ["**/api/**"],
      files: 5,
      violations: 1,
      examples: [{ file: "src/jobs/nightly.controller.ts" }],
    });
  });

  it("proposes the companion most source files have, per language family", () => {
    const files: string[] = ["package.json", "src/index.ts", "src/types.d.ts"];
    for (let i = 0; i < 6; i++) files.push(`src/orders/s${i}.ts`, `src/orders/s${i}.test.ts`);
    files.push("src/orders/leak.ts");
    for (let i = 0; i < 5; i++) files.push(`internal/x/f${i}.go`, `internal/x/f${i}_test.go`);
    const layouts = discoverLayout(files);
    expect(layouts.map((l) => [l.kind, l.from, l.companion, l.files, l.violations])).toEqual([
      ["companion", ["src/**/*.ts"], ["{dir}/{base}.test{ext}"], 7, 1],
      ["companion", ["internal/**/*.go"], ["{dir}/{base}_test.go"], 5, 0],
    ]);
    expect(layouts[0]?.examples).toEqual([{ file: "src/orders/leak.ts" }]);
    expect(layouts[0]?.exclude).toContain("**/*.test.*");
  });

  it("proposes nothing for a kind that lives everywhere, or a convention half kept", () => {
    const files = ["a/x.controller.ts", "b/y.controller.ts", "c/z.controller.ts"];
    for (let i = 0; i < 6; i++) files.push(`src/m${i}.ts`);
    for (let i = 0; i < 3; i++) files.push(`src/m${i}.test.ts`);
    expect(discoverLayout(files)).toEqual([]);
  });
});
