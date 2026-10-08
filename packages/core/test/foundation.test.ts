// Milestone 0 exit gate (Build Plan §4.5): four deliberately different standards
// must be valid documents of the same schema, with no special cases.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatDiagnostic, loadFile } from "../src/index.js";

const root = fileURLToPath(new URL("../../../examples/foundation/.groundrule/", import.meta.url));

describe("foundation standards", async () => {
  const standardFiles = (await readdir(join(root, "standards"))).filter((f) => f.endsWith(".yaml"));

  it("contains the four foundation kinds", () => {
    expect(standardFiles.sort()).toEqual([
      "AI-003.yaml",
      "AUTH-017.yaml",
      "DEP-008.yaml",
      "PROC-004.yaml",
    ]);
  });

  it.each(standardFiles)("%s is a valid standard whose id matches its file name", async (file) => {
    const result = await loadFile(join(root, "standards", file), "Standard");
    if (!result.ok) throw new Error(result.diagnostics.map(formatDiagnostic).join("\n"));
    expect(`${result.document.metadata.id}.yaml`).toBe(file);
  });

  it("config.yaml is valid", async () => {
    const result = await loadFile(join(root, "config.yaml"), "Config");
    if (!result.ok) throw new Error(result.diagnostics.map(formatDiagnostic).join("\n"));
  });

  it("exceptions.yaml is valid", async () => {
    const result = await loadFile(join(root, "exceptions.yaml"), "ExceptionList");
    if (!result.ok) throw new Error(result.diagnostics.map(formatDiagnostic).join("\n"));
  });
});
