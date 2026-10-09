// `groundrule propose` and `groundrule mcp`: proposing rules from the terminal and from
// coding agents. The platform is a fake; nothing leaves the test.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type IO, run } from "../src/index.js";

const URL_ = "https://app.groundrule.test";
const TOKEN = `grt_${"p".repeat(43)}`;
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function repo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-propose-"));
  dirs.push(root);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/web.git"], { cwd: root });
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  return root;
}

const CONNECTED = {
  ".groundrule/config.yaml":
    "apiVersion: groundrule.dev/v1alpha1\nkind: Config\nplatform:\n  org: acme\n",
};
const LOCAL = {
  ".groundrule/config.yaml":
    "apiVersion: groundrule.dev/v1alpha1\nkind: Config\nextends:\n  - groundrule:packs/security-baseline\n",
  "src/app.ts": "export const x = 1;\n",
};

function fakePlatform(reply: { status?: number; body?: object } = {}) {
  const calls: { path: string; auth?: string | undefined; body?: Record<string, unknown> }[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({
      path: url.pathname.replace(/^\/api/, ""),
      auth: (init?.headers as Record<string, string>)?.authorization,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return new Response(
      JSON.stringify(
        reply.body ?? {
          id: "p1",
          status: "open",
          duplicate: false,
          similar: [{ id: "SEC-006", score: 0.5 }],
          url: `${URL_}/acme/inbox`,
          org: { slug: "acme", name: "Acme" },
        },
      ),
      { status: reply.status ?? 201 },
    );
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

async function cli(
  cwd: string,
  argv: string[],
  fetch: typeof globalThis.fetch,
  env: Record<string, string> = { GROUNDRULE_TOKEN: TOKEN },
  stdin?: string[],
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
    ...(stdin
      ? {
          stdin: (async function* () {
            for (const line of stdin) yield `${line}\n`;
          })(),
        }
      : {}),
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

describe("groundrule propose", () => {
  it("sends the rule with where it came from, and says where to find it", async () => {
    const root = await repo(CONNECTED);
    const platform = fakePlatform();
    const r = await cli(
      root,
      [
        "propose",
        "Never",
        "call",
        "Stripe",
        "directly;",
        "use",
        "PaymentsGateway",
        "--why",
        "Retries live there",
        "--file",
        "src/pay.ts:42",
      ],
      platform.fetch,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `✓ Proposed to Acme. Reviewers will see it in the inbox: ${URL_}/acme/inbox`,
    );
    expect(r.stdout).toContain("Similar rules: SEC-006");
    expect(platform.calls).toEqual([
      {
        path: "/v1/cli/proposals",
        auth: `Bearer ${TOKEN}`,
        body: {
          rule: "Never call Stripe directly; use PaymentsGateway",
          why: "Retries live there",
          file: "src/pay.ts",
          line: 42,
          via: "cli",
          repository: "acme/web",
        },
      },
    ]);
  });

  it("explains duplicates, rejections, and what to do when it can't send", async () => {
    const root = await repo(CONNECTED);
    const dup = fakePlatform({
      status: 200,
      body: {
        id: "p1",
        status: "open",
        duplicate: true,
        similar: [],
        url: `${URL_}/acme/inbox`,
        org: { slug: "acme", name: "Acme" },
      },
    });
    expect(
      (await cli(root, ["propose", "Prefer small pull requests"], dup.fetch)).stdout,
    ).toContain("Already proposed in Acme");
    const rejected = fakePlatform({
      status: 200,
      body: {
        id: "p1",
        status: "rejected",
        duplicate: true,
        similar: [],
        url: "x",
        org: { slug: "acme", name: "Acme" },
      },
    });
    expect(
      (await cli(root, ["propose", "Prefer small pull requests"], rejected.fetch)).stdout,
    ).toContain("already rejected");
    const forbidden = fakePlatform({
      status: 403,
      body: { error: { code: "forbidden", message: "nope" } },
    });
    const r403 = await cli(root, ["propose", "Prefer small pull requests"], forbidden.fetch);
    expect(r403.code).toBe(2);
    expect(r403.stderr).toContain("Run `groundrule login` again");

    expect((await cli(root, ["propose", "too short"], dup.fetch)).stderr).toContain(
      "Say the rule in a sentence",
    );
    expect(
      (await cli(root, ["propose", "Never commit .env files", "--file", "../x"], dup.fetch)).stderr,
    ).toContain("relative");
    const loose = await repo({});
    const notConnected = await cli(loose, ["propose", "Never commit .env files"], dup.fetch, {});
    expect(notConnected.code).toBe(2);
    expect(notConnected.stderr).toContain("isn't connected to Groundrule");
    const signedOut = await cli(root, ["propose", "Never commit .env files"], dup.fetch, {});
    expect(signedOut.stderr).toContain("Not signed in to acme");
  });
});

describe("groundrule mcp", () => {
  const session = (calls: object[]) => calls.map((c) => JSON.stringify(c));

  it("serves the standards and proposes rules for a coding agent over stdio", async () => {
    const root = await repo(LOCAL);
    const platform = fakePlatform();
    const r = await cli(
      root,
      ["mcp"],
      platform.fetch,
      { GROUNDRULE_TOKEN: TOKEN },
      session([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "Claude Code", version: "2.1" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_standards", arguments: { query: "private keys" } },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "propose_rule",
            arguments: {
              rule: "Never call Stripe directly; use PaymentsGateway.",
              file: "src/pay.ts",
              line: 3,
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "propose_rule", arguments: { rule: "x" } },
        },
      ]),
    );
    expect(r.code).toBe(0);
    // stdout carries only protocol messages.
    const replies = r.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const by = (id: number) => replies.find((m) => m.id === id);
    expect(by(1).result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "groundrule" },
    });
    expect(by(1).result.instructions).toContain("propose_rule");
    expect(by(2).result.tools.map((t: { name: string }) => t.name)).toEqual([
      "list_standards",
      "propose_rule",
    ]);
    expect(by(3).result.isError).toBe(false);
    expect(by(3).result.content[0].text).toMatch(
      /^SEC-001 \(blocker\) No private keys in the repository:/,
    );
    expect(by(4).result).toMatchObject({ isError: false, structuredContent: { id: "p1" } });
    expect(by(4).result.content[0].text).toContain(
      "Proposed to Acme. A reviewer will accept or reject it",
    );
    expect(platform.calls[0]?.body).toEqual({
      rule: "Never call Stripe directly; use PaymentsGateway.",
      file: "src/pay.ts",
      line: 3,
      via: "mcp",
      repository: "acme/web",
      agent: "claude code",
    });
    expect(by(5).result.isError).toBe(true);
    expect(by(5).result.content[0].text).toContain(
      "Not proposed: rule: Say the rule in a sentence.",
    );
    expect(platform.calls).toHaveLength(1);
  });

  it("reports a platform problem to the agent instead of failing", async () => {
    const root = await repo(LOCAL);
    const r = await cli(
      root,
      ["mcp"],
      fakePlatform().fetch,
      {},
      session([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "propose_rule", arguments: { rule: "Never commit .env files." } },
        },
      ]),
    );
    const reply = JSON.parse(r.stdout.trim());
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain(
      "Not proposed: This repository isn't connected to Groundrule",
    );
  });
});
