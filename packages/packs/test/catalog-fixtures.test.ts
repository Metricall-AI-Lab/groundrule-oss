// The catalog precision harness (Adoption Plan A3).
//
// Every catalog standard with checks has a fixture file in fixtures/<pack>/<ID>.yaml:
// small repositories that must be flagged (`violation`) and near misses that must not
// be (`clean`). Each case runs in its own temporary git repository with only that
// pack enabled, exactly as a user would run `groundrule check --all`.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFile, loadWorkspace, runChecks } from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import type { Standard } from "@groundrule/spec";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { CATALOG_DIR, listPacks, resolvePack } from "../src/index.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

const Fixture = z.strictObject({
  standard: z.string().regex(/^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]+$/),
  cases: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        expect: z.enum(["violation", "clean"]),
        /** Minimum number of findings for a violation case. Defaults to 1. */
        count: z.number().int().positive().optional(),
        files: z.record(z.string().min(1), z.string()),
      }),
    )
    .min(2),
});
type Fixture = z.infer<typeof Fixture>;

const tmp: string[] = [];
afterAll(async () => {
  for (const d of tmp) await rm(d, { recursive: true, force: true });
});

async function standardsOf(pack: string): Promise<Standard[]> {
  const dir = join(CATALOG_DIR, pack, "standards");
  if (!existsSync(dir)) return [];
  const out: Standard[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort()) {
    const result = await loadFile(join(dir, file), "Standard");
    if (!result.ok) throw new Error(`${pack}/${file}: ${JSON.stringify(result.diagnostics)}`);
    out.push(result.document);
  }
  return out;
}

async function fixturesOf(pack: string): Promise<Fixture[]> {
  const dir = join(FIXTURES_DIR, pack);
  if (!existsSync(dir)) return [];
  const out: Fixture[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort()) {
    const parsed = Fixture.safeParse(parse(await readFile(join(dir, file), "utf8")));
    if (!parsed.success)
      throw new Error(`fixtures/${pack}/${file}: ${JSON.stringify(parsed.error.issues)}`);
    if (`${parsed.data.standard}.yaml` !== file)
      throw new Error(`fixtures/${pack}/${file} must be named ${parsed.data.standard}.yaml`);
    out.push(parsed.data);
  }
  return out;
}

/**
 * Fixtures write secret-shaped test values with a split marker, e.g. `npm_ab⟨⟩cd…`, so the
 * committed files never contain anything a secret scanner (or GitHub push protection) would
 * flag. The marker is removed when the case's repository is written.
 */
export const SPLIT = "⟨⟩";
const unsplit = (text: string) => text.replaceAll(SPLIT, "");

/** Run one case: a fresh repository with the given files and only `pack` enabled. */
async function run(pack: string, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-fixture-"));
  tmp.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const all = {
    ".groundrule/config.yaml": `apiVersion: groundrule.dev/v1alpha1\nkind: Config\nextends: [groundrule:packs/${pack}]\n`,
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    const path = join(root, unsplit(rel));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, unsplit(content));
  }
  const loaded = await loadWorkspace({ cwd: root, resolveRegistry: resolvePack });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const result = await runChecks({
    workspace: loaded.workspace,
    evaluators: builtinEvaluators,
    mode: "all",
  });
  return result;
}

const packs = (await readdir(CATALOG_DIR, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const loaded = await Promise.all(
  packs.map(async (pack) => ({
    pack,
    standards: await standardsOf(pack),
    fixtures: await fixturesOf(pack),
  })),
);

describe("catalog fixtures", () => {
  it("every catalog folder is a registered pack", async () => {
    const listed = (await listPacks()).map((p) => p.id).sort();
    expect(listed).toEqual(packs);
  });

  for (const { pack, standards, fixtures } of loaded) {
    describe(pack, () => {
      it("has fixtures for every checked standard, with a violation and a clean case", () => {
        const problems: string[] = [];
        for (const s of standards) {
          if (s.spec.checks.length === 0) continue;
          const f = fixtures.find((x) => x.standard === s.metadata.id);
          if (!f) {
            problems.push(`${s.metadata.id}: no fixtures/${pack}/${s.metadata.id}.yaml`);
            continue;
          }
          if (!f.cases.some((c) => c.expect === "violation"))
            problems.push(`${s.metadata.id}: needs at least one violation case`);
          if (!f.cases.some((c) => c.expect === "clean"))
            problems.push(`${s.metadata.id}: needs at least one clean case (a near miss)`);
        }
        for (const f of fixtures)
          if (!standards.some((s) => s.metadata.id === f.standard))
            problems.push(`fixtures/${pack}/${f.standard}.yaml has no matching standard`);
        expect(problems).toEqual([]);
      });

      for (const fixture of fixtures) {
        for (const c of fixture.cases) {
          it(`${fixture.standard}: ${c.expect} — ${c.name}`, async () => {
            const result = await run(pack, c.files);
            expect(result.diagnostics).toEqual([]);
            const hits = result.findings.filter((f) => f.standardId === fixture.standard);
            const where = hits.map(
              (f) => `${f.location?.file ?? "repo"}:${f.location?.startLine ?? 0} ${f.message}`,
            );
            if (c.expect === "clean") expect(where, "false positive").toEqual([]);
            else expect(hits.length, "missed violation").toBeGreaterThanOrEqual(c.count ?? 1);
          });
        }
      }
    });
  }
});
