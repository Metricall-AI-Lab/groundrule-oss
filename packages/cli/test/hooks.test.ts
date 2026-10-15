// Coding agents checking their own work: the MCP `check` tool, `groundrule hooks` (installs a
// stop hook) and `groundrule hook <agent>` (what the agent runs when it finishes).
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withHook } from "../src/commands/hooks.js";
import { type IO, run } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const CONFIG = {
  ".groundrule/config.yaml":
    "apiVersion: groundrule.dev/v1alpha1\nkind: Config\nextends:\n  - groundrule:packs/security-baseline\n",
  "src/app.ts": "export const x = 1;\n",
};
// Built at run time so this file holds no key-shaped string.
const LEAK = `export const key = "${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}";\n`;

async function repo(files: Record<string, string> = CONFIG) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-hooks-"));
  dirs.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: root,
      stdio: "pipe",
    });
  git("init", "-q", "-b", "main");
  const write = async (rel: string, content: string) => {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  };
  for (const [rel, content] of Object.entries(files)) await write(rel, content);
  git("add", "-A");
  git("commit", "-qm", "init");
  return { root, write };
}

async function cli(cwd: string, argv: string[], stdin?: string, extra: Partial<IO> = {}) {
  let stdout = "";
  let stderr = "";
  const io: IO = {
    cwd,
    env: { NO_COLOR: "1" },
    ...extra,
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
    ...(stdin !== undefined
      ? {
          stdin: (async function* () {
            yield stdin;
          })(),
        }
      : {}),
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

describe("withHook", () => {
  it("adds the Claude Code stop hook next to existing hooks and settings, once", () => {
    const theirs = { hooks: [{ type: "command", command: "./lint.sh" }] };
    const config = { permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [theirs] } };
    const once = withHook(config, "claude-code", true);
    expect(once).toEqual({
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        Stop: [
          theirs,
          {
            hooks: [
              {
                type: "command",
                command: "npx --yes '@groundrule/cli@>=0.4.0' hook claude-code",
                timeout: 120,
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [
              {
                type: "command",
                command: "npx --yes '@groundrule/cli@>=0.4.0' hook claude-code --before-edit",
                timeout: 5,
              },
            ],
          },
        ],
      },
    });
    expect(withHook(once, "claude-code", true)).toEqual(once);
    expect(withHook(once, "claude-code", false)).toEqual(config);
  });

  it("removes only Groundrule's hook, and an emptied hooks object", () => {
    const config = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "npx @groundrule/cli@0.3.0 hook claude-code" },
              { type: "command", command: "./mine.sh" },
            ],
          },
        ],
      },
    };
    expect(withHook(config, "claude-code", false)).toEqual({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./mine.sh" }] }] },
    });
    expect(withHook(withHook({}, "codex", true), "codex", false)).toEqual({});
  });

  it("writes Cursor's version 1 shape with one follow-up per turn", () => {
    expect(withHook({}, "cursor", true)).toEqual({
      version: 1,
      hooks: {
        stop: [
          {
            command: "npx --yes '@groundrule/cli@>=0.4.0' hook cursor",
            timeout: 120,
            loop_limit: 1,
          },
        ],
      },
    });
  });
});

describe("Copilot's hook", () => {
  it("is an agentStop entry in Groundrule's own version 1 file, kept apart from others", () => {
    const theirs = { type: "command", bash: "./lint.sh", timeoutSec: 30 };
    const config = { version: 1, hooks: { agentStop: [theirs] } };
    const once = withHook(config, "copilot", true);
    expect(once).toEqual({
      version: 1,
      hooks: {
        agentStop: [
          theirs,
          {
            type: "command",
            bash: "npx --yes '@groundrule/cli@>=0.4.0' hook copilot",
            powershell: "npx --yes '@groundrule/cli@>=0.4.0' hook copilot",
            timeoutSec: 120,
          },
        ],
      },
    });
    expect(withHook(once, "copilot", true)).toEqual(once);
    expect(withHook(once, "copilot", false)).toEqual(config);
  });

  it("is set up when the repository uses Copilot, and removed with its file", async () => {
    const { root, write } = await repo();
    await write(".github/copilot-instructions.md", "Team notes\n");
    const r = await cli(root, ["hooks"]);
    expect(r.stdout).toContain(
      "Copilot checks its work when it finishes: .github/hooks/groundrule.json",
    );
    expect((await json(join(root, ".github/hooks/groundrule.json"))).hooks.agentStop).toHaveLength(
      1,
    );
    const removed = await cli(root, ["hooks", "--remove", "--agents", "copilot"]);
    expect(removed.stdout).toContain(
      "Removed the Groundrule hook from .github/hooks/groundrule.json",
    );
    await expect(readFile(join(root, ".github/hooks/groundrule.json"), "utf8")).rejects.toThrow();
  });

  it("makes Copilot take another turn with what to fix, once", async () => {
    const { root, write } = await repo();
    await write("src/keys.ts", LEAK);
    const event = (active: boolean) =>
      JSON.stringify({
        sessionId: "s",
        cwd: root,
        stopReason: "end_turn",
        stop_hook_active: active,
      });
    const out = JSON.parse((await cli(root, ["hook", "copilot"], event(false))).stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("SEC-003");
    expect((await cli(root, ["hook", "copilot"], event(true))).stdout).toBe("");
  });
});

describe("groundrule hooks", () => {
  it("installs for Claude Code and the agents the repository already uses, then removes", async () => {
    const { root, write } = await repo();
    await write(".cursor/rules/team.mdc", "x\n");
    await write(".claude/settings.json", '{ "permissions": { "allow": ["Bash(ls)"] } }\n');
    const r = await cli(root, ["hooks"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "Claude Code checks its work when it finishes: .claude/settings.json",
    );
    expect(r.stdout).toContain("Cursor checks its work when it finishes: .cursor/hooks.json");
    expect(r.stdout).not.toContain("Codex");
    expect((await json(join(root, ".claude/settings.json"))).permissions).toEqual({
      allow: ["Bash(ls)"],
    });
    expect((await json(join(root, ".cursor/hooks.json"))).version).toBe(1);

    const again = await cli(root, ["hooks"]);
    expect(again.stdout).toContain(".claude/settings.json already has the Groundrule hook");
    expect(again.stdout).not.toContain("Commit");

    const removed = await cli(root, ["hooks", "--remove"]);
    expect(removed.code).toBe(0);
    expect(await json(join(root, ".claude/settings.json"))).toEqual({
      permissions: { allow: ["Bash(ls)"] },
    });
  });

  it("leaves a file that isn't valid JSON alone, and rejects unknown agents", async () => {
    const { root, write } = await repo();
    await write(".claude/settings.json", "{ nope");
    const r = await cli(root, ["hooks", "--agents", "claude-code"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(".claude/settings.json isn't valid JSON, so it was left alone.");
    expect(await readFile(join(root, ".claude/settings.json"), "utf8")).toBe("{ nope");
    expect((await cli(root, ["hooks", "--agents", "windsurf"])).stderr).toContain(
      "Unknown agent: windsurf.",
    );
  });
});

describe("groundrule hook", () => {
  it("blocks Claude Code from finishing with what to fix, once per turn", async () => {
    const { root, write } = await repo();
    await write("src/keys.ts", LEAK);
    const event = (active: boolean) => JSON.stringify({ cwd: root, stop_hook_active: active });
    const r = await cli(dirname(root), ["hook", "claude-code"], event(false));
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(
      /^Groundrule check failed on uncommitted changes: 1 blocking finding\. Fix it before you finish/,
    );
    expect(out.reason).toContain("SEC-003 No access tokens in code (blocker) at src/keys.ts:1:");
    expect(out.reason).toContain("Fix: ");
    // Already continuing because of this hook: let the agent finish.
    expect((await cli(root, ["hook", "claude-code"], event(true))).stdout).toBe("");
  });

  it("says nothing when the check passes, and never fails the agent", async () => {
    const { root } = await repo();
    const passed = await cli(root, ["hook", "codex"], "{}");
    expect(passed).toMatchObject({ code: 0, stdout: "" });
    const bare = await mkdtemp(join(tmpdir(), "groundrule-hooks-bare-"));
    dirs.push(bare);
    const unconfigured = await cli(bare, ["hook", "claude-code"], "not json");
    expect(unconfigured.code).toBe(0);
    expect(unconfigured.stdout).toBe("");
    expect(unconfigured.stderr).toContain(
      "Groundrule: This repository has no Groundrule configuration",
    );
  });

  it("queues a Cursor follow-up only when the agent completed", async () => {
    const { root, write } = await repo();
    await write("src/keys.ts", LEAK);
    const done = await cli(
      root,
      ["hook", "cursor"],
      JSON.stringify({ status: "completed", workspace_roots: [root] }),
    );
    expect(JSON.parse(done.stdout).followup_message).toContain("SEC-003");
    const aborted = await cli(root, ["hook", "cursor"], JSON.stringify({ status: "aborted" }));
    expect(aborted.stdout).toBe("");
  });
});

describe("the MCP check tool", () => {
  const session = (...calls: object[]) => `${calls.map((c) => JSON.stringify(c)).join("\n")}\n`;
  const call = (id: number, args: object) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "check", arguments: args },
  });

  it("checks uncommitted changes, a branch, or a bad ref, and reports to the agent", async () => {
    const { root, write } = await repo();
    await write("src/keys.ts", LEAK);
    const r = await cli(
      root,
      ["mcp"],
      session(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t" } },
        },
        call(2, {}),
        call(3, { base: "--output=/tmp/x" }),
        call(4, { base: "main" }),
      ),
    );
    expect(r.code).toBe(0);
    const by = (id: number) =>
      r.stdout
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
        .find((m) => m.id === id);
    expect(by(1).result.instructions).toContain("call check and fix every blocking finding");
    expect(by(2).result.isError).toBe(false);
    expect(by(2).result.content[0].text).toContain("1 blocking finding");
    expect(by(2).result.structuredContent).toMatchObject({
      failed: true,
      findings: [{ standardId: "SEC-003", blocking: true, file: "src/keys.ts", line: 1 }],
    });
    expect(by(3).result).toMatchObject({ isError: true });
    expect(by(3).result.content[0].text).toContain("isn't a git ref");
    // Uncommitted work is included when comparing with a branch.
    expect(by(4).result.content[0].text).toContain("changes since main");
  });
});

// ---------------------------------------------------------------- reports (RFC 0012)

const URL_ = "https://app.groundrule.test";
const TOKEN = `grt_${"a".repeat(43)}`;

/** A workspace whose one rule flags access keys, and a log of what the CLI sent it. */
function fakeWorkspace() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/api/, "");
    calls.push({
      method: init?.method ?? "GET",
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), { status });
    if (path === "/v1/cli/rulebook")
      return json(200, {
        org: { slug: "acme", name: "Acme", codingAgents: [] },
        target: { level: "organization", team: null, repository: { name: "acme/payments-api" } },
        repositoryKnown: true,
        generatedAt: new Date().toISOString(),
        standards: [
          {
            stage: "enforce",
            origin: "organization",
            document: {
              apiVersion: "groundrule.dev/v1alpha1",
              kind: "Standard",
              metadata: { id: "ORG-001", title: "No access keys in code", type: "prohibition" },
              spec: {
                severity: "blocker",
                requirement: "Never commit access keys.",
                checks: [{ evaluator: "regex", pattern: "AKIA[0-9A-Z]{16}", include: ["src/**"] }],
              },
            },
          },
        ],
      });
    if (path === "/v1/cli/agent-checks") return json(202, {});
    return json(404, { error: { code: "not_found", message: "no route" } });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const connected = (reports?: string) => ({
  ".groundrule/config.yaml": `apiVersion: groundrule.dev/v1alpha1\nkind: Config\nplatform:\n  org: acme\n${reports ? `  reports: ${reports}\n` : ""}`,
  "src/app.ts": "export const x = 1;\n",
});

describe("agent check reports", () => {
  const env = { NO_COLOR: "1", GROUNDRULE_URL: URL_, GROUNDRULE_TOKEN: TOKEN };
  const reports = (calls: { path: string; body?: unknown }[]) =>
    calls
      .filter((c) => c.path === "/v1/cli/agent-checks")
      .map((c) => c.body as Record<string, unknown>);

  it("sends counts per rule from the hook, with a hashed session and no path or code", async () => {
    const { root, write } = await repo(connected());
    await write("src/keys.ts", LEAK);
    const ws = fakeWorkspace();
    const event = JSON.stringify({ cwd: root, stop_hook_active: false, session_id: "s-123" });
    const r = await cli(root, ["hook", "claude-code"], event, { env, fetch: ws.fetch });
    expect(JSON.parse(r.stdout).decision).toBe("block");
    const [sent] = reports(ws.calls);
    expect(sent).toMatchObject({
      kind: "AgentCheck",
      repository: { name: "acme/payments-api" },
      agent: { name: "claude-code", via: "hook", session: expect.stringMatching(/^[0-9a-f]{64}$/) },
      check: { mode: "changes", files: 1, standards: 1 },
      findings: [{ id: "ORG-001", severity: "blocker", count: 1, blocking: true }],
      stopped: true,
    });
    const text = JSON.stringify(sent);
    expect(text).not.toContain("keys.ts");
    expect(text).not.toContain("AKIA");
    expect(text).not.toContain("s-123");
    // A clean check reports too, so the workspace can tell quiet from absent.
    await write("src/keys.ts", "export const fine = 1;\n");
    const ws2 = fakeWorkspace();
    await cli(root, ["hook", "codex"], JSON.stringify({ cwd: root }), { env, fetch: ws2.fetch });
    expect(reports(ws2.calls)).toEqual([
      expect.objectContaining({
        agent: { name: "codex", via: "hook" },
        findings: [],
        stopped: false,
      }),
    ]);
  });

  it("sends nothing with platform.reports: none, or when the repository isn't connected", async () => {
    const { root, write } = await repo(connected("none"));
    await write("src/keys.ts", LEAK);
    const ws = fakeWorkspace();
    const r = await cli(root, ["hook", "claude-code"], JSON.stringify({ cwd: root }), {
      env,
      fetch: ws.fetch,
    });
    expect(JSON.parse(r.stdout).decision).toBe("block");
    expect(reports(ws.calls)).toEqual([]);
    const local = await repo();
    await local.write("src/keys.ts", LEAK);
    const off = fakeWorkspace();
    await cli(local.root, ["hook", "claude-code"], JSON.stringify({ cwd: local.root }), {
      env,
      fetch: off.fetch,
    });
    expect(off.calls).toEqual([]);
  });

  it("reports from the MCP check tool with the client's name, after answering", async () => {
    const { root, write } = await repo(connected());
    await write("src/keys.ts", LEAK);
    const ws = fakeWorkspace();
    const lines = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Cursor", version: "2.0" },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check", arguments: {} } },
    ];
    const r = await cli(root, ["mcp"], `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, {
      env,
      fetch: ws.fetch,
    });
    expect(r.stdout).toContain("Groundrule check failed");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reports(ws.calls)).toEqual([
      expect.objectContaining({
        agent: { name: "cursor", via: "mcp", client: { name: "Cursor", version: "2.0" } },
        findings: [{ id: "ORG-001", severity: "blocker", count: 1, blocking: true }],
        stopped: true,
      }),
    ]);
  });
});

// ---------------------------------------------------------------- just-in-time rules (ADR 0010)

const SCOPED = {
  ...CONFIG,
  ".groundrule/standards/pay.yaml": `apiVersion: groundrule.dev/v1alpha1
kind: Standard
metadata:
  id: PAY-001
  title: Amounts in minor units
  type: requirement
spec:
  severity: blocker
  requirement: Payment code keeps amounts as integers in minor units; never floats.
  remediation: Use the Money type from src/payments/money.ts.
  scope:
    paths: ["src/payments/**"]
`,
  "src/payments/money.ts": "export type Money = { cents: number };\n",
};

describe("just-in-time rules", () => {
  it("answers rules_for with the rules that name the files, and counts the rest", async () => {
    const { root } = await repo(SCOPED);
    const lines = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t" } },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "rules_for",
          arguments: { files: ["src/payments/refund.ts", "src/app.ts"] },
        },
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "rules_for", arguments: { files: ["src/app.ts"] } },
      },
    ];
    const r = await cli(root, ["mcp"], `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const replies = r.stdout
      .trim()
      .split("\n")
      .map(
        (l) =>
          JSON.parse(l) as {
            id: number;
            result: {
              content: { text: string }[];
              structuredContent?: { rules: unknown[]; unscoped: number };
            };
          },
      );
    const two = replies.find((x) => x.id === 2)?.result;
    expect(two?.content[0]?.text).toContain(
      "- PAY-001 (blocker) Amounts in minor units: Payment code keeps amounts as integers in minor units; never floats. Fix: Use the Money type from src/payments/money.ts. [src/payments/refund.ts]",
    );
    expect(two?.content[0]?.text).toMatch(/\d+ repository-wide rules are in the agent file/);
    expect(two?.structuredContent?.rules).toHaveLength(1);
    expect(two?.structuredContent?.unscoped).toBeGreaterThan(5);
    const three = replies.find((x) => x.id === 3)?.result;
    expect(three?.content[0]?.text).toMatch(/^No rule names src\/app\.ts specifically\./);
  });

  it("tells Claude Code the rules for a file before it edits it, once per session", async () => {
    const { root } = await repo(SCOPED);
    const session = `jit-${Date.now()}`;
    const event = (file: string, s = session) =>
      JSON.stringify({
        cwd: root,
        session_id: s,
        tool_name: "Edit",
        tool_input: { file_path: join(root, file) },
      });
    const first = await cli(
      root,
      ["hook", "claude-code", "--before-edit"],
      event("src/payments/refund.ts"),
    );
    expect(first.code).toBe(0);
    const out = JSON.parse(first.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "Groundrule rules for src/payments/refund.ts",
    );
    expect(out.hookSpecificOutput.additionalContext).toContain("PAY-001 (blocker)");
    // The same file in the same session: nothing more to say.
    expect(
      (await cli(root, ["hook", "claude-code", "--before-edit"], event("src/payments/refund.ts")))
        .stdout,
    ).toBe("");
    // Another session hears it again; a file no rule names gets nothing; a relative path works.
    expect(
      (
        await cli(
          root,
          ["hook", "claude-code", "--before-edit"],
          event("src/payments/refund.ts", `${session}-b`),
        )
      ).stdout,
    ).toContain("PAY-001");
    expect(
      (await cli(root, ["hook", "claude-code", "--before-edit"], event("src/app.ts"))).stdout,
    ).toBe("");
    const relativeEvent = JSON.stringify({
      cwd: root,
      tool_name: "Write",
      tool_input: { file_path: "src/payments/new.ts" },
    });
    expect(
      (await cli(root, ["hook", "claude-code", "--before-edit"], relativeEvent)).stdout,
    ).toContain("PAY-001");
    // Garbage never holds up an edit.
    expect(await cli(root, ["hook", "claude-code", "--before-edit"], "not json")).toMatchObject({
      code: 0,
      stdout: "",
    });
  });
});
