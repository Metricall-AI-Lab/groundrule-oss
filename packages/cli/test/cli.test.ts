import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type IO, run } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function repo(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-cli-"));
  dirs.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  git("init", "-q", "-b", "main");
  const write = async (rel: string, content: string) => {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  };
  for (const [rel, content] of Object.entries(files)) await write(rel, content);
  return { root, git, write };
}

async function cli(cwd: string, ...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const io: IO = {
    cwd,
    env: { NO_COLOR: "1" },
    stdout: {
      write: (t: string) => {
        stdout += t;
      },
    },
    stderr: {
      write: (t: string) => {
        stderr += t;
      },
    },
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

const TS_APP = {
  "package.json": '{\n  "name": "app",\n  "dependencies": {}\n}\n',
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "src/app.ts": "export const ok = 1;\n",
};

describe("groundrule CLI", () => {
  it("prints help and version", async () => {
    const r = await repo();
    expect((await cli(r.root, "--help")).stdout).toContain("Define engineering standards once");
    expect(await cli(r.root, "--version")).toMatchObject({ code: 0, stdout: "0.1.0\n" });
    expect((await cli(r.root, "nope")).code).toBe(2);
  });

  it("init → sync → check: the happy path", async () => {
    const r = await repo(TS_APP);
    const init = await cli(r.root, "init");
    expect(init.code).toBe(0);
    expect(init.stdout).toContain("Packs    security-baseline, typescript-node");
    const config = await readFile(join(r.root, ".groundrule/config.yaml"), "utf8");
    expect(config).toContain("- groundrule:packs/typescript-node");

    expect((await cli(r.root, "init")).code).toBe(2); // already initialized

    expect((await cli(r.root, "sync", "--check")).code).toBe(1);
    const sync = await cli(r.root, "sync");
    expect(sync.stdout).toContain("+ AGENTS.md created");
    expect(await readFile(join(r.root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    expect((await cli(r.root, "sync", "--check")).code).toBe(0);

    const check = await cli(r.root, "check", "--all");
    expect(check.stdout).toContain("Passed");
    expect(check.code).toBe(0);
  });

  it("fails on new blockers in changed code, with exit code 1", async () => {
    const r = await repo(TS_APP);
    await cli(r.root, "init");
    r.git("add", "-A");
    r.git("commit", "-q", "-m", "init");
    await r.write(
      "src/app.ts",
      "export const ok = 1;\nexport const run = (s: string) => eval(s);\n",
    );

    const check = await cli(r.root, "check");
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("✕ TS-003  No eval or new Function");
    expect(check.stdout).toContain("src/app.ts:2");

    const lenient = await cli(r.root, "check", "--fail-on", "none");
    expect(lenient.code).toBe(0);
  });

  it("writes JSON, SARIF, and Markdown reports", async () => {
    const r = await repo({ ...TS_APP, "src/app.ts": 'console.log("x");\n' });
    await cli(r.root, "init");

    const json = await cli(r.root, "check", "--all", "--format", "json");
    const report = JSON.parse(json.stdout);
    expect(report.findings.map((f: { standardId: string }) => f.standardId)).toEqual(["TS-001"]);

    const sarif = await cli(r.root, "check", "--all", "-f", "sarif", "-o", "out.sarif");
    expect(sarif.stdout).toContain("Wrote sarif report to out.sarif (passed)");
    expect(
      JSON.parse(await readFile(join(r.root, "out.sarif"), "utf8")).runs[0].results[0].ruleId,
    ).toBe("TS-001");

    expect((await cli(r.root, "check", "--all", "-f", "markdown")).stdout).toContain(
      "### Groundrule · ⚠ Passed with 1 warning",
    );

    await cli(r.root, "check", "--all", "--summary", "summary.md");
    expect(await readFile(join(r.root, "summary.md"), "utf8")).toContain("### Groundrule");
  });

  it("explains a standard, case-insensitively, and suggests close matches", async () => {
    const r = await repo(TS_APP);
    await cli(r.root, "init");
    const explain = await cli(r.root, "explain", "sec-002");
    expect(explain.stdout).toContain("SEC-002  No environment files in the repository");
    expect(explain.stdout).toContain("How to fix");
    const missing = await cli(r.root, "explain", "SEC-999");
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("Did you mean SEC-001");
  });

  it("lists standards and packs", async () => {
    const r = await repo(TS_APP);
    await cli(r.root, "init");
    const list = await cli(r.root, "standards", "--json");
    expect(JSON.parse(list.stdout).find((s: { id: string }) => s.id === "SEC-001")).toMatchObject({
      severity: "blocker",
      applies: true,
    });
    expect((await cli(r.root, "packs")).stdout).toContain("groundrule:packs/java-spring");
  });

  it("reports configuration errors with file:line and exit code 2", async () => {
    const r = await repo({
      ".groundrule/config.yaml":
        "apiVersion: groundrule.dev/v1alpha1\nkind: Config\ntargets: [vim]\n",
    });
    const check = await cli(r.root, "check");
    expect(check.code).toBe(2);
    expect(check.stderr).toMatch(/\.groundrule\/config\.yaml:3:\d+\s+targets\[0\]/);
  });

  it("runs doctor and honors --cwd", async () => {
    const r = await repo(TS_APP);
    await cli(r.root, "init");
    await cli(r.root, "sync");
    const doctor = await cli("/", "-C", r.root, "doctor");
    expect(doctor.stdout).toContain("Everything looks good.");
    expect(doctor.code).toBe(0);
  });

  it("explains how to start when there is no config", async () => {
    const r = await repo();
    const check = await cli(r.root, "check");
    expect(check.code).toBe(2);
    expect(check.stderr).toContain("Run `groundrule init`");
  });
});
