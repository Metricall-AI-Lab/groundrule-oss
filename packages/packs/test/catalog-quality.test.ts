import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadFile } from "@groundrule/core";
import type { Standard } from "@groundrule/spec";
import { describe, expect, it } from "vitest";
import { CATALOG_DIR, listPacks } from "../src/index.js";

/** The catalog quality bar from RFC 0001. User-authored standards are not held to it. */
async function catalogStandards(): Promise<{ pack: string; standard: Standard }[]> {
  const all: { pack: string; standard: Standard }[] = [];
  for (const pack of await listPacks()) {
    const dir = join(CATALOG_DIR, pack.id, "standards");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".yaml"))) {
      const result = await loadFile(join(dir, file), "Standard");
      if (!result.ok) throw new Error(`${pack.id}/${file}: ${JSON.stringify(result.diagnostics)}`);
      all.push({ pack: pack.id, standard: result.document });
    }
  }
  return all;
}

describe("catalog quality bar", () => {
  it("gives every pack a semantic version", async () => {
    for (const pack of await listPacks()) expect(pack.version, pack.id).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("has unique standard IDs across packs", async () => {
    const ids = (await catalogStandards()).map((s) => s.standard.metadata.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("explains, rates, and stages every standard", async () => {
    const problems: string[] = [];
    for (const { pack, standard } of await catalogStandards()) {
      const { id, category } = standard.metadata;
      const spec = standard.spec;
      const where = `${pack}/${id}`;
      if (!spec.intent && !spec.rationale) problems.push(`${where}: needs intent or rationale`);
      if (!spec.quality) problems.push(`${where}: needs quality.noise`);
      if (!spec.rollout) problems.push(`${where}: needs rollout.recommendedStage`);
      if (spec.checks.length > 0 && !spec.remediation)
        problems.push(`${where}: has checks, so needs remediation`);
      if (category === "security" && !spec.references?.length)
        problems.push(`${where}: security standards cite at least one reference`);
      if (spec.checks.length === 0 && spec.rollout && spec.rollout.recommendedStage !== "teach")
        problems.push(`${where}: guidance-only standards start at teach`);
    }
    expect(problems).toEqual([]);
  });

  it("only maps known compliance frameworks", async () => {
    const known = new Set(["soc2", "iso-27001", "owasp-asvs", "pci-dss", "hipaa", "nist-ssdf"]);
    for (const { standard } of await catalogStandards())
      for (const c of standard.spec.compliance ?? [])
        expect(known.has(c.framework), `${standard.metadata.id} ${c.framework}`).toBe(true);
  });
});
