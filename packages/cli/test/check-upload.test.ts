// `groundrule check --upload` (RFC 0005): the run goes to the platform with its repository,
// commit and pull request; snippets are redacted and optional; and the check's own exit code
// stands whatever happens to the upload. The platform is a fake; nothing leaves the test.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckRun } from "@groundrule/spec";
import { afterEach, describe, expect, it } from "vitest";
import { pullRequestFromCi } from "../src/ci.js";
import { type IO, run } from "../src/index.js";

const URL_ = "https://app.groundrule.test";
const TOKEN = `grt_${"a".repeat(43)}`;
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const git = (root: string, ...args: string[]) =>
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

const standard = (id: string, category: string, pattern: string, severity = "blocker") =>
  JSON.stringify({
    apiVersion: "groundrule.dev/v1alpha1",
    kind: "Standard",
    metadata: { id, title: `${id} title`, type: "prohibition", category },
    spec: {
      severity,
      requirement: `Rule ${id}.`,
      checks: [{ evaluator: "regex", pattern, include: ["src/**"], message: `${id} found` }],
    },
  });

// A credential-shaped value, assembled at runtime so no secret-like string is committed.
const KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "groundrule-check-upload-"));
  dirs.push(root);
  const files: Record<string, string> = {
    ".groundrule/config.yaml": "apiVersion: groundrule.dev/v1alpha1\nkind: Config\n",
    ".groundrule/standards/PAY-001.yaml": standard("PAY-001", "payments", "amount \\* 1\\.0"),
    ".groundrule/standards/SEC-900.yaml": standard("SEC-900", "security", "AKIA[A-Z]{16}"),
    ".groundrule/standards/LOG-001.yaml": standard("LOG-001", "logging", "AKIA", "warning"),
    "src/refunds.ts": `export const total = (amount: number) => amount * 1.0;\nexport const k = "${KEY}";\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  git(root, "init", "-q", "-b", "fix/refunds");
  git(root, "remote", "add", "origin", "git@github.com:acme/payments.git");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

interface Call {
  path: string;
  auth?: string | undefined;
  body?: unknown;
}

function fakePlatform(status = 201) {
  const calls: Call[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({
      path: `${url.pathname.replace(/^\/api/, "")}${url.search}`,
      auth: (init?.headers as Record<string, string>)?.authorization,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (status !== 201)
      return new Response(
        JSON.stringify({ error: { code: "unavailable", message: "Groundrule is down." } }),
        { status },
      );
    return new Response(
      JSON.stringify({
        id: "c1",
        url: `${URL_}/acme/checks/c1`,
        org: { slug: "acme", name: "Acme" },
      }),
      { status: 201 },
    );
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

async function cli(
  cwd: string,
  argv: string[],
  fetch: typeof globalThis.fetch,
  env: Record<string, string> = {},
) {
  let stdout = "";
  let stderr = "";
  const io: IO = {
    cwd,
    env: { NO_COLOR: "1", GROUNDRULE_URL: URL_, ...env },
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
    fetch,
    configDir: join(cwd, ".no-credentials"),
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

async function prEvent(root: string, pr: Record<string, unknown>) {
  const path = join(root, ".event.json");
  await writeFile(path, JSON.stringify({ action: "opened", pull_request: pr }));
  return { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: path };
}

const PR = {
  number: 42,
  title: "Add refunds",
  html_url: "https://github.com/acme/payments/pull/42",
  head: { ref: "fix/refunds", sha: "a".repeat(40) },
  base: { ref: "main" },
  user: { login: "octocat" },
};

describe("groundrule check --upload", () => {
  it("sends the run with its repository, commit and pull request, and keeps the exit code", async () => {
    const root = await repo();
    const platform = fakePlatform();
    const r = await cli(root, ["check", "--all", "--upload", "--org", "acme"], platform.fetch, {
      GROUNDRULE_TOKEN: TOKEN,
      ...(await prEvent(root, PR)),
    });
    expect(r.code).toBe(1); // PAY-001 and SEC-900 are blockers
    expect(r.stdout).toContain(`Uploaded to Acme: ${URL_}/acme/checks/c1`);
    expect(platform.calls).toHaveLength(1);
    expect(platform.calls[0]).toMatchObject({
      path: "/v1/cli/checks?org=acme",
      auth: `Bearer ${TOKEN}`,
    });
    const body = CheckRun.parse(platform.calls[0]?.body);
    expect(body.repository).toMatchObject({ name: "acme/payments", branch: "fix/refunds" });
    expect(body.repository.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(body.pullRequest).toEqual({
      number: 42,
      title: "Add refunds",
      url: "https://github.com/acme/payments/pull/42",
      headRef: "fix/refunds",
      baseRef: "main",
      author: "octocat",
    });
    expect(body).toMatchObject({
      mode: "all",
      passed: false,
      failOn: "blocker",
      omittedFindings: 0,
    });
    const pay = body.findings.find((f) => f.standardId === "PAY-001");
    expect(pay).toMatchObject({
      blocking: true,
      file: "src/refunds.ts",
      line: 1,
      snippet: "export const total = (amount: number) => amount * 1.0;",
    });
    // A security rule never sends a snippet; others have credentials redacted.
    expect(body.findings.find((f) => f.standardId === "SEC-900")?.snippet).toBeUndefined();
    const log = body.findings.find((f) => f.standardId === "LOG-001");
    expect(log?.snippet).toBeDefined();
    expect(log?.snippet).not.toContain(KEY);
    expect(body.outcomes.map((o) => o.id).sort()).toEqual(["LOG-001", "PAY-001", "SEC-900"]);
  });

  it("sends no snippets with --no-snippets, and no pull request outside one", async () => {
    const root = await repo();
    const platform = fakePlatform();
    await cli(root, ["check", "--all", "--upload", "--no-snippets"], platform.fetch, {
      GROUNDRULE_TOKEN: TOKEN,
      GITHUB_EVENT_NAME: "push",
    });
    const body = CheckRun.parse(platform.calls[0]?.body);
    expect(body.metadata.snippets).toBe(false);
    expect(body.findings.every((f) => f.snippet === undefined)).toBe(true);
    expect(body.pullRequest).toBeUndefined();
    expect(platform.calls[0]?.path).toBe("/v1/cli/checks");
  });

  it("keeps the check's result when the upload fails", async () => {
    const root = await repo();
    const r = await cli(root, ["check", "--all", "--upload"], fakePlatform(503).fetch, {
      GROUNDRULE_TOKEN: TOKEN,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "Upload failed: Groundrule is down. The check result above still stands.",
    );

    const passing = await repo();
    await writeFile(join(passing, "src/refunds.ts"), "export const ok = 1;\n");
    const ok = await cli(passing, ["check", "--all", "--upload"], fakePlatform(503).fetch, {
      GROUNDRULE_TOKEN: TOKEN,
    });
    expect(ok.code).toBe(0);
  });

  it("stops before checking when not signed in", async () => {
    const root = await repo();
    const platform = fakePlatform();
    const r = await cli(root, ["check", "--all", "--upload"], platform.fetch);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Not signed in on https://app.groundrule.test");
    expect(platform.calls).toHaveLength(0);
  });

  it("keeps JSON output clean: the upload line goes to stderr", async () => {
    const root = await repo();
    const r = await cli(
      root,
      ["check", "--all", "--upload", "--format", "json"],
      fakePlatform().fetch,
      {
        GROUNDRULE_TOKEN: TOKEN,
      },
    );
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stderr).toContain("Uploaded to Acme");
  });
});

describe("the pull request from CI", () => {
  const io = (env: Record<string, string>): IO => ({
    cwd: "/",
    env,
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  });

  it("comes from GitHub's pull_request event, and survives a bad optional field", async () => {
    const root = await repo();
    expect(await pullRequestFromCi(io(await prEvent(root, PR)))).toMatchObject({ number: 42 });
    const odd = await pullRequestFromCi(
      io(await prEvent(root, { ...PR, html_url: "http://insecure.example/pr/42" })),
    );
    expect(odd).toEqual({ number: 42 });
  });

  it("is undefined outside a pull request or when the payload can't be read", async () => {
    expect(await pullRequestFromCi(io({}))).toBeUndefined();
    expect(
      await pullRequestFromCi(io({ GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "/nope" })),
    ).toBeUndefined();
    expect(
      await pullRequestFromCi(
        io({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/does/not/exist.json" }),
      ),
    ).toBeUndefined();
  });
});
