// Hosted checks (ADR 0029 in the backend): `groundrule check` with every input as a file,
// no network and no git, gives the same findings as the same check in CI, writes the result
// as a CheckRun, and refuses anything that would reach the network or leave the repository.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { getChanges } from "@groundrule/core";
import { CheckRun } from "@groundrule/spec";
import { afterEach, describe, expect, it } from "vitest";
import { type IO, run } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const standard = (id: string, pattern: string, severity = "blocker", category = "payments") => ({
  apiVersion: "groundrule.dev/v1alpha1",
  kind: "Standard",
  metadata: { id, title: `${id} title`, type: "prohibition", category },
  spec: {
    severity,
    requirement: `Rule ${id}.`,
    checks: [{ evaluator: "regex", pattern, include: ["src/**"], message: `${id} found` }],
  },
});

async function tmp(prefix: string) {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function write(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
}

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
    stdio: "pipe",
  });

async function cli(cwd: string, ...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const io: IO = {
    cwd,
    env: {
      NO_COLOR: "1",
      GROUNDRULE_GITHUB_BASE_URL: "file:///nonexistent-should-never-be-cloned",
    },
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
    fetch: (async () => {
      throw new Error("network access attempted");
    }) as unknown as typeof fetch,
    configDir: join(cwd, ".no-credentials"),
  };
  return { code: await run(argv, io), stdout, stderr };
}

const LOCAL_CONFIG = "apiVersion: groundrule.dev/v1alpha1\nkind: Config\n";
const FILES = {
  ".groundrule/config.yaml": LOCAL_CONFIG,
  ".groundrule/standards/PAY-001.yaml": JSON.stringify(standard("PAY-001", "amount \\* 1\\.0")),
  ".groundrule/standards/LOG-001.yaml": JSON.stringify(
    standard("LOG-001", "console\\.log", "warning", "logging"),
  ),
  "src/legacy.ts": "export const total = (amount: number) => amount * 1.0;\n",
  "src/refunds.ts": "export const ok = 1;\n",
};

const key = (f: {
  standardId: string;
  location?: { file: string; startLine: number };
  isNew: boolean;
  status: string;
}) =>
  `${f.standardId} ${f.location?.file}:${f.location?.startLine} ${f.isNew ? "new" : "legacy"} ${f.status}`;

describe("a hosted check", () => {
  it("finds exactly what the same check finds in CI, without git or network", async () => {
    // CI: a git repository with a change on a branch.
    const ci = await tmp("gr-ci-");
    await write(ci, FILES);
    git(ci, "init", "-q", "-b", "main");
    git(ci, "add", "-A");
    git(ci, "commit", "-qm", "base");
    git(ci, "switch", "-q", "-c", "feature");
    await write(ci, {
      "src/refunds.ts":
        "export const ok = 1;\nexport const fee = (amount: number) => amount * 1.0;\nconsole.log(fee);\n",
      "src/new.ts": "export const x = (amount: number) => amount * 1.0;\n",
    });
    git(ci, "add", "-A");
    git(ci, "commit", "-qm", "change");
    const inCi = await cli(ci, "check", "--base", "main", "-f", "json", "-o", "ci.json");
    expect(inCi.code).toBe(1);

    // Hosted: the same files without .git, and the changes as a file (as the worker builds
    // them from GitHub's pull request files).
    const hosted = await tmp("gr-hosted-");
    await cp(ci, hosted, {
      recursive: true,
      filter: (src) => !src.includes(`${ci}/.git`) && !src.endsWith("ci.json"),
    });
    const changes = await getChanges(ci, "main");
    const inputs = await tmp("gr-inputs-");
    await writeFile(join(inputs, "changes.json"), JSON.stringify(changes));
    const offline = await cli(
      hosted,
      "check",
      "--offline",
      "--changes",
      join(inputs, "changes.json"),
      "-f",
      "json",
      "-o",
      join(inputs, "hosted.json"),
    );
    expect(offline.stderr).not.toContain("network access attempted");
    expect(offline.code).toBe(1);

    const findings = async (file: string) =>
      (JSON.parse(await readFile(file, "utf8")).findings as Parameters<typeof key>[0][])
        .map(key)
        .sort();
    const a = await findings(join(ci, "ci.json"));
    const b = await findings(join(inputs, "hosted.json"));
    expect(b).toEqual(a);
    // Only the changed lines count; the untouched file's old problem isn't reported either way.
    expect(a).toEqual([
      "LOG-001 src/refunds.ts:3 new violation",
      "PAY-001 src/new.ts:1 new violation",
      "PAY-001 src/refunds.ts:2 new violation",
    ]);
  });

  it("writes the result as a CheckRun with the pull request and commit it was given", async () => {
    const root = await tmp("gr-hosted-");
    await write(root, FILES);
    const inputs = await tmp("gr-inputs-");
    await writeFile(
      join(inputs, "changes.json"),
      JSON.stringify([
        { path: "src/legacy.ts", status: "modified", changedLines: [{ start: 1, end: 1 }] },
      ]),
    );
    await writeFile(
      join(inputs, "pr.json"),
      JSON.stringify({
        number: 42,
        title: "Add fee",
        headRef: "feat/fee",
        baseRef: "main",
        headSha: "b".repeat(40),
        author: "octocat",
      }),
    );
    const r = await cli(
      root,
      "check",
      "--offline",
      "--changes",
      join(inputs, "changes.json"),
      "--pull-request",
      join(inputs, "pr.json"),
      "--commit",
      "a".repeat(40),
      "--repository",
      "acme/payments",
      "--no-snippets",
      "--write-check-run",
      join(inputs, "run.json"),
    );
    expect(r.code).toBe(1);
    const result = CheckRun.parse(JSON.parse(await readFile(join(inputs, "run.json"), "utf8")));
    expect(result).toMatchObject({
      repository: { name: "acme/payments", commit: "a".repeat(40), branch: "feat/fee" },
      pullRequest: { number: 42, headSha: "b".repeat(40) },
      mode: "changes",
      passed: false,
      metadata: { snippets: false },
    });
    expect(result.findings[0]).toMatchObject({
      standardId: "PAY-001",
      file: "src/legacy.ts",
      line: 1,
      blocking: true,
    });
    expect(result.findings.every((f) => f.snippet === undefined)).toBe(true);
  });

  it("uses a rulebook handed over as a file, and needs one for a connected repository", async () => {
    const root = await tmp("gr-hosted-");
    await write(root, {
      ".groundrule/config.yaml":
        "apiVersion: groundrule.dev/v1alpha1\nkind: Config\nplatform:\n  org: acme\n",
      "src/a.ts": "export const total = (amount: number) => amount * 1.0;\n",
    });
    const inputs = await tmp("gr-inputs-");
    const rulebook = (org: string) => ({
      org: { slug: org, name: "Acme", codingAgents: [] },
      target: { level: "organization", team: null, repository: null },
      repositoryKnown: false,
      generatedAt: new Date().toISOString(),
      standards: [
        {
          stage: "enforce",
          origin: "organization",
          document: standard("ACME-001", "amount \\* 1\\.0"),
        },
      ],
    });
    await writeFile(join(inputs, "rulebook.json"), JSON.stringify(rulebook("acme")));
    await writeFile(join(inputs, "other.json"), JSON.stringify(rulebook("globex")));

    const missing = await cli(root, "check", "--offline", "--all");
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("Offline, pass the rulebook with --rulebook.");

    const ok = await cli(
      root,
      "check",
      "--offline",
      "--all",
      "--rulebook",
      join(inputs, "rulebook.json"),
      "-f",
      "json",
    );
    expect(ok.code).toBe(1);
    expect(
      JSON.parse(ok.stdout).findings.map((f: { standardId: string }) => f.standardId),
    ).toContain("ACME-001");

    const wrong = await cli(
      root,
      "check",
      "--offline",
      "--all",
      "--rulebook",
      join(inputs, "other.json"),
    );
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain("The rulebook is for globex, but this repository uses acme.");
  });

  it("refuses remote packs, sources outside the repository, and bad input files", async () => {
    const outside = await tmp("gr-outside-");
    await write(outside, { "pack/STD-001.yaml": JSON.stringify(standard("STD-001", "x")) });
    const root = await tmp("gr-hosted-");
    await write(root, {
      ".groundrule/config.yaml": `apiVersion: groundrule.dev/v1alpha1\nkind: Config\nextends:\n  - github:acme/rules\n  - ./${relative(join(root, ".groundrule"), join(outside, "pack"))}\n`,
      "src/a.ts": "x\n",
    });
    const r = await cli(root, "check", "--offline", "--all");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("github:acme/rules isn't fetched when checking offline");
    expect(r.stderr).toContain("is outside the repository, so it isn't read when checking offline");

    const plain = await tmp("gr-hosted-");
    await write(plain, FILES);
    const inputs = await tmp("gr-inputs-");
    await writeFile(
      join(inputs, "bad.json"),
      JSON.stringify([{ path: "../../etc/passwd", status: "modified", changedLines: [] }]),
    );
    await writeFile(join(inputs, "notjson.json"), "nope");
    expect(
      (await cli(plain, "check", "--offline", "--changes", join(inputs, "bad.json"))).stderr,
    ).toContain("must be inside the repository");
    expect(
      (await cli(plain, "check", "--offline", "--changes", join(inputs, "notjson.json"))).stderr,
    ).toContain("it must be a JSON file");
    expect((await cli(plain, "check", "--offline", "--upload")).stderr).toContain(
      "--offline and --upload can't be used together",
    );
    expect((await cli(plain, "check", "--offline", "--commit", "abc")).stderr).toContain(
      "full 40-character commit SHA",
    );
  });
});
