// Compliance mappings: every SOC 2 and ISO 27001 control the catalog maps to has a name, and
// control IDs follow each framework's form, so a report never shows an unknown control.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CATALOG_DIR, COMPLIANCE_CONTROLS, COMPLIANCE_FRAMEWORK_NAMES } from "../src/index.js";

const FORM: Record<string, RegExp> = {
  soc2: /^(CC\d\.\d|A1\.\d|C1\.\d|PI1\.\d|P\d\.\d)$/,
  "iso-27001": /^(5\.\d{1,2}|6\.\d|7\.\d{1,2}|8\.\d{1,2})$/,
};

describe("compliance mappings", () => {
  it("name every SOC 2 and ISO 27001 control the catalog uses", async () => {
    const problems: string[] = [];
    let mapped = 0;
    for (const pack of await readdir(CATALOG_DIR)) {
      const dir = join(CATALOG_DIR, pack, "standards");
      const files = await readdir(dir).catch(() => []);
      for (const f of files) {
        const doc = parse(await readFile(join(dir, f), "utf8")) as {
          metadata: { id: string };
          spec: { compliance?: { framework: string; controls: string[] }[] };
        };
        for (const m of doc.spec.compliance ?? []) {
          if (!COMPLIANCE_FRAMEWORK_NAMES[m.framework])
            problems.push(`${doc.metadata.id}: unknown framework ${m.framework}`);
          const names = COMPLIANCE_CONTROLS[m.framework];
          const form = FORM[m.framework];
          if (!names) continue;
          mapped++;
          for (const c of m.controls) {
            if (form && !form.test(c))
              problems.push(`${doc.metadata.id}: ${m.framework} ${c} isn't a control ID`);
            if (!names[c]) problems.push(`${doc.metadata.id}: ${m.framework} ${c} has no name`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(mapped).toBeGreaterThan(200);
  });
});
