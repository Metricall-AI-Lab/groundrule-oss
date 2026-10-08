// Writes JSON Schema files for every document kind into ./schemas.
// Editors (VS Code YAML, JetBrains) use these for autocomplete and validation.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DOCUMENT_SCHEMAS, Finding, GroundruleDocument, ScanReport } from "../src/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(packageRoot, "schemas");
mkdirSync(outDir, { recursive: true });

const targets: Record<string, z.ZodType> = {
  ...DOCUMENT_SCHEMAS,
  Finding,
  GroundruleDocument,
  ScanReport,
};

for (const [name, schema] of Object.entries(targets)) {
  // "input" so fields with defaults are optional, which is what authors write.
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const fileName = `${name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}.schema.json`;
  writeFileSync(
    join(outDir, fileName),
    `${JSON.stringify({ $id: `https://groundrule.dev/schemas/v1alpha1/${fileName}`, ...json }, null, 2)}\n`,
  );
}
console.log(`Wrote ${Object.keys(targets).length} JSON Schemas to ${outDir}`);
