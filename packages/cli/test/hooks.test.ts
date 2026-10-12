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

async function cli(cwd: string, argv: string[], stdin?: string) {
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
