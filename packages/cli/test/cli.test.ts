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
    // Installing hooks never reaches npm from a test.
    env: { NO_COLOR: "1", GROUNDRULE_HOOKS_NO_WARM: "1" },
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
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(await cli(r.root, "--version")).toMatchObject({ code: 0, stdout: `${version}\n` });
    expect((await cli(r.root, "nope")).code).toBe(2);
  });

  it("init → sync → check: the happy path", async () => {
    const r = await repo(TS_APP);
    const init = await cli(r.root, "init");
    expect(init.code).toBe(0);
    // A new repository starts from the essentials; --packs still chooses others.
    expect(init.stdout).toContain("Packs    essentials");
    const config = await readFile(join(r.root, ".groundrule/config.yaml"), "utf8");
    expect(config).toContain("- groundrule:packs/essentials");

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
    await cli(r.root, "init", "--packs", "security-baseline,typescript-node");

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
    expect(explain.stdout).toContain("Recommended starting stage: enforce");
    expect(explain.stdout).toContain("Expected noise: low");
    expect(explain.stdout).toContain(
      "OWASP Application Security Verification Standard 4.0: V2.10.4",
    );
    expect(explain.stdout).toContain("CWE-538 Insertion of Sensitive Information");
    expect(explain.stdout).toContain("https://cwe.mitre.org/data/definitions/538.html");
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

  it("says when a blocker rule has no check and so can't fail a change", async () => {
    const rule = (id: string, checks: unknown[]) =>
      JSON.stringify({
        apiVersion: "groundrule.dev/v1alpha1",
        kind: "Standard",
        metadata: { id, title: `${id} title`, type: "prohibition", category: "testing" },
        spec: { severity: "blocker", requirement: `Rule ${id}.`, checks },
      });
    const r = await repo({
      ".groundrule/config.yaml": "apiVersion: groundrule.dev/v1alpha1\nkind: Config\n",
      ".groundrule/standards/TEACH-001.yaml": rule("TEACH-001", []),
      ".groundrule/standards/CHK-001.yaml": rule("CHK-001", [
        { evaluator: "regex", pattern: "forbidden", message: "no" },
      ]),
    });
    const list = (await cli(r.root, "standards")).stdout;
    expect(list).toMatch(/TEACH-001[\s\S]*agent guidance[^\n]*can't fail a change/);
    expect(list).toMatch(/CHK-001[\s\S]*checked by regex/);
    expect(list.match(/can't fail a change/g)).toHaveLength(1);
    const explain = (await cli(r.root, "explain", "TEACH-001")).stdout;
    expect(explain).toContain("can't fail a change. Add a check to enforce it.");
    expect((await cli(r.root, "explain", "CHK-001")).stdout).not.toContain("can't fail");
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

describe("groundrule start", () => {
  const APP = {
    "package.json": '{\n  "name": "app",\n  "dependencies": { "request": "^2.88.0" }\n}\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "src/app.ts": 'console.log("hi");\nexport const x = 1;\n',
  };

  /** Run with someone at the terminal who types `answer`. */
  async function interactive(cwd: string, answer: string, ...argv: string[]) {
    let stdout = "";
    const stdin = Object.assign(
      (async function* () {
        yield answer;
      })(),
      { isTTY: true },
    );
    const io: IO = {
      cwd,
      env: { NO_COLOR: "1", GROUNDRULE_HOOKS_NO_WARM: "1" },
      stdout: {
        isTTY: true,
        write: (t: string) => {
          stdout += t;
        },
      },
      stderr: { write: () => {} },
      stdin,
    };
    return { code: await run(argv, io), stdout };
  }
  const has = async (root: string, rel: string) =>
    readFile(join(root, rel), "utf8").then(
      () => true,
      () => false,
    );

  it("shows what the checks find today and writes nothing when nobody is there to ask", async () => {
    const { root } = await repo(APP);
    // `groundrule` alone, in a repository with no configuration, is the guided start.
    const r = await cli(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("a first look at");
    // The essentials are all checked, and the count is the rules that apply here.
    expect(r.stdout).toMatch(/\d+ rules from essentials apply here/);
    expect(r.stdout).toContain("every one is checked on every change");
    expect(r.stdout).toContain("What the checks find in this repository today");
    expect(r.stdout).toContain("TS-002  No deprecated HTTP and UUID packages");
    expect(r.stdout).toContain("package.json:");
    expect(r.stdout).toContain("it is listed, and it never blocks");
    // A first look has no verdict: "Passed" on a repository with findings would mislead.
    expect(r.stdout).not.toMatch(/Passed|Failed/);
    expect(r.stdout).toContain("Nothing was written. To set it up, run groundrule start --yes");
    for (const f of [".groundrule/config.yaml", "AGENTS.md", ".claude/settings.json"])
      expect(await has(root, f), f).toBe(false);
  });

  it("sets everything up with --yes, or without the hooks", async () => {
    const { root } = await repo(APP);
    const r = await cli(root, "start", "--yes", "--no-hooks");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("✓ Set up. Commit these files");
    expect(await has(root, ".groundrule/config.yaml")).toBe(true);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("TS-002");
    expect(await has(root, ".claude/settings.json")).toBe(false);
    expect(r.stdout).not.toContain(".claude/settings.json");

    const again = await cli(root, "start");
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("This repository is already set up");
    expect(again.stderr).toBe("");
    // With a configuration, `groundrule` alone is the usage text again.
    expect((await cli(root)).stdout).not.toContain("a first look");

    const other = await repo(APP);
    const withHooks = await cli(other.root, "start", "-y");
    expect(withHooks.stdout).toContain(".groundrule/  AGENTS.md  CLAUDE.md  .claude/settings.json");
    expect(await readFile(join(other.root, ".claude/settings.json"), "utf8")).toContain(
      "--before-tool",
    );
  });

  it("asks one question at a terminal: Enter or y sets up, n writes nothing", async () => {
    const yes = await repo(APP);
    const y = await interactive(yes.root, "\n");
    expect(y.stdout).toContain("Set it up now? [Y/n]");
    expect(y.stdout).toContain("✓ Set up.");
    expect(await has(yes.root, "AGENTS.md")).toBe(true);
    expect(await has(yes.root, ".claude/settings.json")).toBe(true);

    const no = await repo(APP);
    const n = await interactive(no.root, "n\n", "start");
    expect(n.code).toBe(0);
    expect(n.stdout).toContain("Nothing was written. Run groundrule start again");
    expect(await has(no.root, ".groundrule/config.yaml")).toBe(false);
  });

  it("says so when the checks find nothing", async () => {
    const { root } = await repo({ "README.md": "# hi\n" });
    const r = await cli(root, "start");
    expect(r.stdout).toContain("✓ The checks find nothing in this repository today.");
  });
});

describe("the essentials", () => {
  it("is a short set that is all checked, and grows into the full packs without clashing", async () => {
    const r = await repo({
      "package.json": '{\n  "name": "app",\n  "dependencies": {}\n}\n',
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
      "src/orders.ts":
        "export const byId = (db: Db, id: string) =>\n  db.query(`SELECT * FROM orders WHERE id = ${id}`);\n",
    });
    await cli(r.root, "init");
    const list = await cli(r.root, "standards");
    expect(list.stdout).not.toContain("agent guidance");
    // The SQL built from a string is flagged: a blocker with a check, not an instruction.
    const check = await cli(r.root, "check", "--all");
    expect(check.stdout).toContain("✕ SEC-015  Use parameterized queries, never string-built SQL");
    expect(check.stdout).toContain("src/orders.ts:2");
    expect(check.code).toBe(1);

    // Adding a full pack that holds some of the same standards is not a duplicate.
    const config = join(r.root, ".groundrule/config.yaml");
    await writeFile(
      config,
      (await readFile(config, "utf8")).replace(
        "  - groundrule:packs/essentials",
        "  - groundrule:packs/essentials\n  - groundrule:packs/security-baseline",
      ),
    );
    const doctor = await cli(r.root, "sync");
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).not.toContain("Duplicate");

    const packs = await cli(r.root, "packs");
    expect(packs.stdout).toMatch(
      /groundrule:packs\/essentials · \d+ standards from the packs below, all checked/,
    );
  });
});
