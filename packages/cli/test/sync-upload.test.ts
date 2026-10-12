// `groundrule sync --upload` (RFC 0006): what a repository delivers to coding agents goes to
// the platform: agent files and their state, rule IDs, stop hooks and MCP settings. Never
// file contents, and the sync's own exit code stands whatever happens to the upload.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentSync } from "@groundrule/spec";
import { afterEach, describe, expect, it } from "vitest";
import { type IO, run } from "../src/index.js";

const URL_ = "https://app.groundrule.test";
const TOKEN = `grt_${"s".repeat(43)}`;
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function repo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-sync-upload-"));
  dirs.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: root,
      stdio: "pipe",
    });
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "git@github.com:acme/web.git");
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  git("add", "-A");
  git("commit", "-qm", "init");
  return root;
}

const CONFIG =
  "apiVersion: groundrule.dev/v1alpha1\nkind: Config\nextends:\n  - groundrule:packs/security-baseline\ntargets: [agents-md, claude-code, cursor]\n";

function fakePlatform(status = 201) {
  const calls: { path: string; body?: unknown }[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({
      path: `${url.pathname.replace(/^\/api/, "")}${url.search}`,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (status !== 201)
      return new Response(
        JSON.stringify({ error: { code: "unavailable", message: "Groundrule is down." } }),
        { status },
      );
    return new Response(
      JSON.stringify({ url: `${URL_}/acme/agents`, org: { slug: "acme", name: "Acme" } }),
      { status: 201 },
    );
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

async function cli(cwd: string, argv: string[], fetch: typeof globalThis.fetch, env = {}) {
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

describe("groundrule sync --upload", () => {
  it("reports out-of-date files, hooks and MCP settings, and keeps the exit code", async () => {
    const root = await repo({
      ".groundrule/config.yaml": CONFIG,
      "AGENTS.md": "# Team notes\n",
      ".claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "npx --yes '@groundrule/cli@>=0.4.0' hook claude-code",
                },
              ],
            },
          ],
        },
      }),
      ".mcp.json": JSON.stringify({
        mcpServers: { rules: { command: "npx", args: ["-y", "@groundrule/cli", "mcp"] } },
      }),
      ".cursor/mcp.json": JSON.stringify({
        mcpServers: { other: { command: "node", args: ["x.js"] } },
      }),
    });
    const platform = fakePlatform();
    const r = await cli(root, ["sync", "--check", "--upload"], platform.fetch, {
      GROUNDRULE_TOKEN: TOKEN,
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Agent instructions are out of date");
    expect(r.stdout).toContain(`✓ Reported to Acme: ${URL_}/acme/agents`);
    expect(platform.calls).toHaveLength(1);
    expect(platform.calls[0]?.path).toBe("/v1/cli/agent-syncs");
    const body = AgentSync.parse(platform.calls[0]?.body);
    expect(body).toMatchObject({
      kind: "AgentSync",
      repository: { name: "acme/web", branch: "main" },
      rulebook: "local",
      upToDate: false,
      targets: [
        { target: "agents-md", files: [{ path: "AGENTS.md", status: "outdated" }] },
        { target: "claude-code", files: [{ path: "CLAUDE.md", status: "missing" }] },
        { target: "cursor", files: [{ path: ".cursor/rules/groundrule.mdc", status: "missing" }] },
      ],
      hooks: [
        { agent: "claude-code", installed: true },
        { agent: "codex", installed: false },
        { agent: "cursor", installed: false },
        { agent: "copilot", installed: false },
      ],
      mcp: [
        { client: "claude-code", configured: true },
        { client: "cursor", configured: false },
        { client: "vscode", configured: false },
      ],
    });
    expect(body.repository.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(body.standards.delivered).toBe(body.standards.ids.length);
    expect(body.standards.ids).toContain("SEC-001");
    // Paths and IDs only: nothing from the files themselves.
    expect(JSON.stringify(body)).not.toContain("Team notes");
  });

  it("reports everything current after writing", async () => {
    const root = await repo({ ".groundrule/config.yaml": CONFIG });
    const platform = fakePlatform();
    const r = await cli(root, ["sync", "--upload"], platform.fetch, { GROUNDRULE_TOKEN: TOKEN });
    expect(r.code).toBe(0);
    const body = AgentSync.parse(platform.calls[0]?.body);
    expect(body.upToDate).toBe(true);
    expect(body.targets.flatMap((t) => t.files.map((f) => f.status))).toEqual([
      "current",
      "current",
      "current",
    ]);
  });

  it("never fails because of the upload, and needs a sign-in before doing anything", async () => {
    const root = await repo({ ".groundrule/config.yaml": CONFIG });
    await cli(root, ["sync"], fakePlatform().fetch);
    const down = fakePlatform(503);
    const r = await cli(root, ["sync", "--check", "--upload"], down.fetch, {
      GROUNDRULE_TOKEN: TOKEN,
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(
      "! Upload failed: Groundrule is down. The result above still stands.",
    );

    const none = fakePlatform();
    const unsigned = await cli(root, ["sync", "--check", "--upload"], none.fetch);
    expect(unsigned.code).toBe(2);
    expect(unsigned.stderr).toContain("Not signed in");
    expect(none.calls).toHaveLength(0);
  });
});
