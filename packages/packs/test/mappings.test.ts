import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_DIR, TOOL_MAPPING } from "../src/index.js";

describe("tool mappings", () => {
  it("point only at rules that exist in the catalog", async () => {
    const ids = new Set<string>();
    for (const pack of await readdir(CATALOG_DIR)) {
      const files = await readdir(join(CATALOG_DIR, pack, "standards")).catch(() => []);
      for (const f of files) if (f.endsWith(".yaml")) ids.add(f.replace(/\.yaml$/, ""));
    }
    const missing = Object.entries(TOOL_MAPPING).flatMap(([tool, table]) =>
      Object.entries(table as Record<string, string>)
        .filter(([, id]) => !ids.has(id))
        .map(([setting, id]) => `${tool}:${setting} → ${id}`),
    );
    expect(missing).toEqual([]);
  });

  it("use exact Ruff codes, so prefix selection works", () => {
    for (const code of Object.keys(TOOL_MAPPING.ruff)) expect(code).toMatch(/^[A-Z]+[0-9]+$/);
  });
});
