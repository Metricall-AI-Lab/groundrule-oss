import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { effectiveStandards, loadWorkspace } from "../src/index.js";
import { CONFIG, standardYaml, tempRepo } from "./repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function repo(files: Record<string, string>) {
  const r = await tempRepo(files);
  cleanups.push(r.cleanup);
  return r;
}

const simple = (id: string, severity = "warning") =>
  standardYaml(id, `  severity: ${severity}\n  requirement: Do it.`);

describe("loadWorkspace", () => {
  it("explains how to start when there is no config", async () => {
    const r = await repo({ "README.md": "" });
    const result = await loadWorkspace({ cwd: r.root });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.message).toMatch(/groundrule init/);
  });

  it("finds the config from a subdirectory and loads local standards", async () => {
    const r = await repo({
      ".groundrule/config.yaml": CONFIG(),
      ".groundrule/standards/A-1.yaml": simple("A-1"),
      "src/deep/file.ts": "",
    });
    const result = await loadWorkspace({ cwd: join(r.root, "src/deep") });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.workspace.root).toBe(await realpath(r.root));
    expect(result.workspace.standards.map((s) => [s.standard.metadata.id, s.origin])).toEqual([
      ["A-1", "local"],
    ]);
  });

  it("resolves packs: local pack files, plain directories, pack extends, and registry names", async () => {
    const r = await repo({
      ".groundrule/config.yaml": CONFIG(
        "extends:\n  - ./packs/security\n  - ../shared\n  - groundrule:packs/base",
      ),
      ".groundrule/packs/security/pack.yaml":
        "apiVersion: groundrule.dev/v1alpha1\nkind: Pack\nmetadata:\n  id: security\n  title: Security\nspec:\n  extends: [./inner]\n",
      ".groundrule/packs/security/standards/SEC-1.yaml": simple("SEC-1"),
      ".groundrule/packs/security/inner/INNER-1.yaml": simple("INNER-1"),
      "shared/SHARED-1.yaml": simple("SHARED-1"),
    });
    const registryDir = join(r.root, "registry-base");
    await mkdir(registryDir, { recursive: true });
    await writeFile(join(registryDir, "BASE-1.yaml"), simple("BASE-1"));

    const result = await loadWorkspace({
      cwd: r.root,
      resolveRegistry: (name) => (name === "packs/base" ? registryDir : undefined),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(
      Object.fromEntries(result.workspace.standards.map((s) => [s.standard.metadata.id, s.origin])),
    ).toEqual({
      "BASE-1": "groundrule:packs/base",
      "INNER-1": "local:.groundrule/packs/security/inner",
      "SEC-1": "local:.groundrule/packs/security",
      "SHARED-1": "local:shared",
    });
  });

  it("rejects duplicate IDs, pointing at both files", async () => {
    const r = await repo({
      ".groundrule/config.yaml": CONFIG("extends: [./packs/a]"),
      ".groundrule/packs/a/X-1.yaml": simple("X-1"),
      ".groundrule/standards/X-1.yaml": simple("X-1"),
    });
    const result = await loadWorkspace({ cwd: r.root });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics[0]?.message).toMatch(
        /Duplicate standard X-1; also defined in \.groundrule\/packs\/a\/X-1\.yaml/,
      );
  });

  it("reports unknown registry packs and missing local paths", async () => {
    const r = await repo({
      ".groundrule/config.yaml": CONFIG("extends:\n  - groundrule:packs/nope\n  - ./missing"),
    });
    const result = await loadWorkspace({ cwd: r.root, resolveRegistry: () => undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        expect.stringMatching(/Unknown pack "groundrule:packs\/nope"/),
        expect.stringMatching(/"\.\/missing" does not exist/),
      ]);
    }
  });

  it("detects circular pack extends", async () => {
    const pack = (id: string, ext: string) =>
      `apiVersion: groundrule.dev/v1alpha1\nkind: Pack\nmetadata:\n  id: ${id}\n  title: ${id}\nspec:\n  extends: [${ext}]\n`;
    const r = await repo({
      ".groundrule/config.yaml": CONFIG("extends: [./a/pack.yaml]"),
      ".groundrule/a/pack.yaml": pack("a", "../b/pack.yaml"),
      ".groundrule/b/pack.yaml": pack("b", "../a/pack.yaml"),
    });
    const result = await loadWorkspace({ cwd: r.root });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.message).toMatch(/circular/);
  });

  it("applies overrides and warns about unknown ones", async () => {
    const r = await repo({
      ".groundrule/config.yaml": CONFIG(
        "overrides:\n  A-1:\n    severity: advisory\n    reason: Legacy\n  B-1:\n    disabled: true\n  Z-9:\n    disabled: true",
      ),
      ".groundrule/standards/A-1.yaml": simple("A-1", "blocker"),
      ".groundrule/standards/B-1.yaml": simple("B-1"),
    });
    const result = await loadWorkspace({ cwd: r.root });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const [a, b] = result.workspace.standards;
    expect(a?.standard.spec.severity).toBe("advisory");
    expect(a?.originalSeverity).toBe("blocker");
    expect(b?.disabled).toBe(true);
    expect(effectiveStandards(result.workspace).map((s) => s.standard.metadata.id)).toEqual([
      "A-1",
    ]);
    expect(result.workspace.diagnostics.map((d) => d.message)).toEqual([
      "Override for unknown standard Z-9.",
    ]);
  });

  it("loads exceptions and warns about expired ones", async () => {
    const r = await repo({
      ".groundrule/config.yaml": CONFIG(),
      ".groundrule/standards/A-1.yaml": simple("A-1"),
      ".groundrule/exceptions.yaml":
        'apiVersion: groundrule.dev/v1alpha1\nkind: ExceptionList\nspec:\n  exceptions:\n    - id: EX-1\n      standard: A-1\n      reason: r\n      expires: "2000-01-01"\n',
    });
    const result = await loadWorkspace({ cwd: r.root });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.workspace.exceptions).toHaveLength(1);
    expect(result.workspace.diagnostics[0]?.message).toMatch(/expired on 2000-01-01/);
  });

  it("fetches github: sources (via a local bare repository)", async () => {
    const remote = await repo({ "packs/sec/R-1.yaml": simple("R-1") });
    const base = join(remote.root, "..");
    // github:<parent-dir-name>/<repo-dir-name> resolves to file://<parent>/<parent-dir-name>/<repo-dir-name>
    const parentName = base.split("/").pop() ?? "";
    const repoName = remote.root.split("/").pop() ?? "";
    const r = await repo({
      ".groundrule/config.yaml": CONFIG(
        `extends:\n  - github:${parentName}/${repoName}//packs/sec`,
      ),
    });
    const result = await loadWorkspace({
      cwd: r.root,
      githubBaseUrl: `file://${join(base, "..")}`,
      cacheDir: join(r.root, ".cache"),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.workspace.standards.map((s) => s.origin)).toEqual([
      `github:${parentName}/${repoName}//packs/sec`,
    ]);
  });
});
