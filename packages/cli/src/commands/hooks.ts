import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { inspectRepository, repositoryName } from "@groundrule/core";
import { HOOK_AGENTS, type HookAgent } from "@groundrule/spec";
import { checkForAgent, reportAgentCheck } from "../agent-report.js";
import { actionFromHook, answerFor, reportAgentAction } from "../before-tool.js";
import { EXIT, eprintln, type IO, println, style, VERSION } from "../io.js";
import { rulesFor, rulesForText } from "../rules-for.js";
import { type OpenedWorkspace, openWorkspace } from "../workspace.js";

export { HOOK_AGENTS, type HookAgent };

/** Where each agent reads project hooks from. */
const HOOK_FILE: Record<HookAgent, string> = {
  "claude-code": ".claude/settings.json",
  codex: ".codex/hooks.json",
  cursor: ".cursor/hooks.json",
  // Copilot reads every .github/hooks/*.json; this file is Groundrule's own.
  copilot: ".github/hooks/groundrule.json",
};

/** A repository uses an agent when it has that agent's files (Claude Code is the default). */
const USES: Record<HookAgent, readonly string[]> = {
  "claude-code": [],
  codex: [".codex"],
  cursor: [".cursor"],
  copilot: [".github/hooks", ".github/copilot-instructions.md", ".github/instructions"],
};

const NAME: Record<HookAgent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  copilot: "Copilot",
};

// A bare package name lets npx reuse an older cached CLI without the hook command.
const command = (agent: HookAgent) => `npx --yes '@groundrule/cli@>=0.4.0' hook ${agent}`;
/**
 * The before-tool hook runs on every tool call, so it pins the exact CLI that installed it:
 * npx then serves it from its cache instead of asking the registry to resolve a range each
 * time, and `groundrule hooks` run again moves the pin. The cache is warmed at install, so
 * the first tool call is not the one that downloads it (RFC 0017).
 */
const beforeToolCommand = (agent: HookAgent) =>
  `npx --yes '@groundrule/cli@${VERSION}' hook ${agent} --before-tool`;
/**
 * The tools a policy can decide: shell, edits, reads, fetches and MCP calls. Search and
 * navigation tools are never held up. A policy naming another tool in `when.tools` needs
 * this matcher widened by hand.
 */
export const DECIDED_TOOLS =
  "Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit|Read|WebFetch|mcp__.*";
/** Recognizes a hook this command installed, whatever version wrote it. */
const OURS = /(^|[\s'"])(@groundrule\/cli|groundrule)(@[^\s'"]+)?['"]?\s+hook\s/;
/** Seconds an agent waits for the check before giving up on it. */
const TIMEOUT = 120;
/**
 * Seconds the before-tool hook may take; a tool call is never held longer (RFC 0017). The
 * decision takes milliseconds and a warm start about a second; the budget covers a cold npx
 * cache on a slow connection, because a timed-out hook lets the call through.
 */
const BEFORE_TOOL_TIMEOUT = 30;
/** Minutes a hook reuses the rulebook it fetched, so a tool call never waits on the network. */
const RULEBOOK_CACHE_MS = 10 * 60_000;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const commandOf = (v: unknown) =>
  isObject(v) ? [v.command, v.bash].filter((c) => typeof c === "string").join(" ") : "";

/**
 * Add (or remove) Groundrule's stop hook in an agent's hook config, keeping everything else.
 * Claude Code and Codex share one shape: hooks.Stop[] of { hooks: [{ type, command }] }.
 * Cursor's is version 1 with hooks.stop[] of { command }; Copilot's is version 1 with
 * hooks.agentStop[] of { type, bash, powershell, timeoutSec }.
 */
export function withHook(config: Json, agent: HookAgent, install: boolean): Json {
  const hooks = isObject(config.hooks) ? { ...config.hooks } : {};
  if (agent === "copilot") {
    const stop = (Array.isArray(hooks.agentStop) ? hooks.agentStop : []).filter(
      (h) => !OURS.test(commandOf(h)),
    );
    if (install)
      stop.push({
        type: "command",
        bash: command(agent),
        powershell: command(agent),
        timeoutSec: TIMEOUT,
      });
    if (stop.length) hooks.agentStop = stop;
    else delete hooks.agentStop;
    const before = (Array.isArray(hooks.preToolUse) ? hooks.preToolUse : []).filter(
      (h) => !OURS.test(commandOf(h)),
    );
    if (install)
      before.push({
        type: "command",
        bash: beforeToolCommand(agent),
        powershell: beforeToolCommand(agent),
        timeoutSec: BEFORE_TOOL_TIMEOUT,
      });
    if (before.length) hooks.preToolUse = before;
    else delete hooks.preToolUse;
    return tidy(
      { version: typeof config.version === "number" ? config.version : 1, ...config },
      hooks,
    );
  }
  if (agent === "cursor") {
    const stop = (Array.isArray(hooks.stop) ? hooks.stop : []).filter(
      (h) => !OURS.test(commandOf(h)),
    );
    // One follow-up per turn: the agent fixes what it can, and then it may stop.
    if (install) stop.push({ command: command(agent), timeout: TIMEOUT, loop_limit: 1 });
    if (stop.length) hooks.stop = stop;
    else delete hooks.stop;
    // Cursor decides shell commands, MCP calls and file reads in three events (RFC 0017).
    for (const event of ["beforeShellExecution", "beforeMCPExecution", "beforeReadFile"]) {
      const entries = (Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []).filter(
        (h) => !OURS.test(commandOf(h)),
      );
      if (install)
        entries.push({ command: beforeToolCommand(agent), timeout: BEFORE_TOOL_TIMEOUT });
      if (entries.length) hooks[event] = entries;
      else delete hooks[event];
    }
    return tidy(
      { version: typeof config.version === "number" ? config.version : 1, ...config },
      hooks,
    );
  }
  const withoutOurs = (event: string) =>
    (Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [])
      .map((g) =>
        isObject(g) && Array.isArray(g.hooks)
          ? { ...g, hooks: g.hooks.filter((h) => !OURS.test(commandOf(h))) }
          : g,
      )
      .filter((g) => !(isObject(g) && Array.isArray(g.hooks) && g.hooks.length === 0));
  const stop = withoutOurs("Stop");
  if (install)
    stop.push({ hooks: [{ type: "command", command: command(agent), timeout: TIMEOUT }] });
  if (stop.length) hooks.Stop = stop;
  else delete hooks.Stop;
  // Before every tool call: action policies (RFC 0017), and for Claude Code the rules for the
  // file about to be edited (ADR 0010), in one answer.
  const before = withoutOurs("PreToolUse");
  if (install)
    before.push({
      matcher: DECIDED_TOOLS,
      hooks: [{ type: "command", command: beforeToolCommand(agent), timeout: BEFORE_TOOL_TIMEOUT }],
    });
  if (before.length) hooks.PreToolUse = before;
  else delete hooks.PreToolUse;
  return tidy(config, hooks);
}

/** Drop the hooks object when nothing is left in it. */
function tidy(config: Json, hooks: Json): Json {
  const { hooks: _, ...rest } = config;
  return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

/** Which agents' project settings in this repository run Groundrule's hook. */
export async function installedHooks(
  root: string,
): Promise<{ agent: HookAgent; installed: boolean }[]> {
  return Promise.all(
    HOOK_AGENTS.map(async (agent) => {
      try {
        const config: unknown = JSON.parse(await readFile(join(root, HOOK_FILE[agent]), "utf8"));
        // Installed when removing Groundrule's hook would change the file.
        const installed =
          isObject(config) &&
          JSON.stringify(withHook(config, agent, false)) !== JSON.stringify(config);
        return { agent, installed };
      } catch {
        return { agent, installed: false };
      }
    }),
  );
}

export interface HooksOptions {
  agents?: HookAgent[];
  remove?: boolean;
}

/** `groundrule hooks`: have coding agents run the check when they finish a task. */
export async function hooks(io: IO, options: HooksOptions): Promise<number> {
  const s = style(io);
  const root = io.cwd;
  // Claude Code by default, plus the other agents this repository already configures.
  const agents =
    options.agents ??
    HOOK_AGENTS.filter(
      (a) => a === "claude-code" || USES[a].some((p) => existsSync(join(root, p))),
    );
  let code: number = EXIT.ok;
  let changed = 0;
  for (const agent of agents) {
    const file = HOOK_FILE[agent];
    const path = join(root, file);
    let config: Json = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isObject(parsed)) throw new SyntaxError("not a JSON object");
      config = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        eprintln(
          io,
          `✕ ${file} isn't valid JSON, so it was left alone. Fix it, then run this again.`,
        );
        code = EXIT.usage;
        continue;
      }
      if (options.remove) continue;
    }
    const next = withHook(config, agent, !options.remove);
    if (JSON.stringify(next) === JSON.stringify(config)) {
      println(
        io,
        `  ${file} already ${options.remove ? "has no Groundrule hook" : "has the Groundrule hook"}`,
      );
      continue;
    }
    changed++;
    // Groundrule's own Copilot file goes away with its hook.
    if (agent === "copilot" && !isObject(next.hooks)) await rm(path, { force: true });
    else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
    }
    println(
      io,
      options.remove
        ? `${s.green("✓")} Removed the Groundrule hook from ${file}`
        : `${s.green("✓")} ${NAME[agent]} checks its work when it finishes: ${file}`,
    );
  }
  if (!options.remove && changed && code === EXIT.ok) {
    println(
      io,
      `\nCommit ${agents.length === 1 ? "this file" : "these files"} so everyone's agent runs the check. ${agents.includes("codex") ? "Codex asks each developer to trust the hook once (/hooks). " : ""}Remove with \`groundrule hooks --remove\`.`,
    );
    await warmHook(io);
  }
  return code;
}

const execFileAsync = promisify(execFile);

/**
 * Fetch the pinned CLI into npx's cache now, so the agent's first tool call isn't the one
 * that downloads it and runs into the hook's timeout. Best effort: offline, or a version
 * not on npm yet (a development build), just means the first call warms it instead.
 */
async function warmHook(io: IO): Promise<void> {
  if (io.env.GROUNDRULE_HOOKS_NO_WARM) return;
  const s = style(io);
  println(
    io,
    s.dim(`Warming up the hook (@groundrule/cli@${VERSION}) so the first tool call is fast…`),
  );
  try {
    await execFileAsync("npx", ["--yes", `@groundrule/cli@${VERSION}`, "--version"], {
      cwd: io.cwd,
      timeout: 120_000,
      env: { ...process.env, ...io.env },
    });
  } catch {
    println(io, s.dim("Couldn't warm it up now; the first tool call will."));
  }
}

interface HookInput {
  cwd?: unknown;
  stop_hook_active?: unknown;
  status?: unknown;
  workspace_roots?: unknown;
  /** Claude Code and Codex send session_id; Cursor sends conversation_id. */
  session_id?: unknown;
  conversation_id?: unknown;
  /** PreToolUse: the tool about to run and its arguments. */
  tool_name?: unknown;
  tool_input?: unknown;
}

/** The files a session was already told about, so a file edited ten times is explained once. */
async function alreadyTold(
  session: string | undefined,
  root: string,
  file: string,
): Promise<boolean> {
  if (!session) return false;
  const key = createHash("sha256").update(`${session}\0${root}`).digest("hex");
  const path = join(tmpdir(), `groundrule-jit-${key}.json`);
  try {
    const seen: unknown = JSON.parse(await readFile(path, "utf8"));
    const files = Array.isArray(seen) ? seen.filter((f) => typeof f === "string") : [];
    if (files.includes(file)) return true;
    await writeFile(path, JSON.stringify([...files, file].slice(-500)), { mode: 0o600 });
  } catch {
    try {
      await writeFile(path, JSON.stringify([file]), { mode: 0o600 });
    } catch {
      // No temp dir to remember in: the rules are repeated, which is harmless.
    }
  }
  return false;
}

/** The rules for the file an agent is about to edit, once per file per session (ADR 0010). */
async function editContext(
  workspace: OpenedWorkspace,
  input: HookInput,
  dir: string,
): Promise<string | undefined> {
  const tool = isObject(input.tool_input) ? input.tool_input : {};
  const given = typeof tool.file_path === "string" ? tool.file_path : "";
  if (!given) return undefined;
  const absolute = isAbsolute(given) ? given : resolve(dir, given);
  // Real paths on both sides: a temp dir or a symlinked checkout must not look outside.
  const real = async (p: string): Promise<string> => {
    try {
      return await realpath(p);
    } catch {
      return join(await real(dirname(p)), basename(p));
    }
  };
  const file = relative(await real(workspace.root), await real(absolute)).replace(/\\/g, "/");
  if (!file || file.startsWith("../")) return undefined;
  const session = typeof input.session_id === "string" ? input.session_id : undefined;
  if (await alreadyTold(session, workspace.root, file)) return undefined;
  const repo = await inspectRepository(workspace);
  const result = rulesFor(workspace.standards, repo, [file]);
  if (!result.rules.length) return undefined;
  return rulesForText(result, [file]);
}

/** The directory the agent works in, from its event; otherwise where the hook was started. */
function workingDir(io: IO, input: HookInput): string {
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
  const dir =
    typeof input.cwd === "string" ? input.cwd : typeof roots[0] === "string" ? roots[0] : undefined;
  return dir ? resolve(io.cwd, dir) : io.cwd;
}

/** `groundrule hook claude-code --before-edit`: the rules for the file about to be edited. */
async function beforeEdit(io: IO, input: HookInput): Promise<number> {
  const dir = workingDir(io, input);
  const quiet: IO = { ...io, cwd: dir, stdout: io.stderr };
  const workspace = await openWorkspace(quiet, {
    use: "agents",
    rulebookCacheMs: RULEBOOK_CACHE_MS,
  });
  if (!workspace) return EXIT.ok;
  const context = await editContext(workspace, input, dir);
  if (!context) return EXIT.ok;
  io.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context },
    })}\n`,
  );
  return EXIT.ok;
}

/**
 * `groundrule hook <agent> --before-tool`: decide the action the agent is about to take against
 * the action policies in effect (RFC 0017), and for Claude Code add the rules for a file it is
 * about to edit. No decision when nothing matches, when the repository has no configuration,
 * or when anything goes wrong: the agent's own permission flow applies.
 */
async function beforeTool(io: IO, agent: HookAgent, input: HookInput): Promise<number> {
  const dir = workingDir(io, input);
  const quiet: IO = { ...io, cwd: dir, stdout: io.stderr };
  const workspace = await openWorkspace(quiet, {
    use: "agents",
    rulebookCacheMs: RULEBOOK_CACHE_MS,
  });
  if (!workspace) return EXIT.ok;
  const action = await actionFromHook(agent, input as Json, workspace.root, dir);
  const context =
    agent === "claude-code" && action?.kind === "edit"
      ? await editContext(workspace, input, dir)
      : undefined;
  if (!action) return EXIT.ok;
  const answer = answerFor(
    agent,
    input as Json,
    workspace,
    action,
    {
      repository:
        workspace.platform?.rulebook.target.repository?.name ??
        workspace.config.platform?.repository ??
        repositoryName(workspace.root),
      tags: workspace.config.tags,
    },
    context,
  );
  if (answer.output) io.stdout.write(`${JSON.stringify(answer.output)}\n`);
  if (answer.delivered === "ask" || answer.delivered === "deny") {
    const session = [input.session_id, input.conversation_id].find((v) => typeof v === "string");
    await reportAgentAction(
      quiet,
      workspace,
      agent,
      typeof session === "string" && session ? session : undefined,
      action,
      answer.delivered,
      answer.decision,
    );
  }
  return EXIT.ok;
}

async function readAll(stdin: AsyncIterable<string | Uint8Array>) {
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of stdin)
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  return text;
}

/**
 * `groundrule hook <agent>`: run by the agent when it is about to finish. If the check fails,
 * tell the agent what to fix; otherwise say nothing. Never breaks the agent: problems are
 * reported on stderr and the agent finishes normally.
 */
export async function hook(
  io: IO,
  agent: HookAgent,
  options: { beforeEdit?: boolean; beforeTool?: boolean } = {},
): Promise<number> {
  let input: HookInput = {};
  try {
    // An agent pipes the event in; a person running it in a terminal doesn't.
    const piped = io.stdin && !(io.stdin as { isTTY?: boolean }).isTTY;
    const parsed: unknown = piped && io.stdin ? JSON.parse((await readAll(io.stdin)) || "{}") : {};
    if (isObject(parsed)) input = parsed;
  } catch {
    // An agent that sends no JSON still gets checked.
  }
  if (options.beforeTool) {
    try {
      return await beforeTool(io, agent, input);
    } catch {
      // A tool call is never held up by this hook; without an answer the agent decides.
      return EXIT.ok;
    }
  }
  if (options.beforeEdit) {
    try {
      return await beforeEdit(io, input);
    } catch {
      // An edit is never held up by this hook.
      return EXIT.ok;
    }
  }
  // Ask once per turn, so an agent that can't fix something isn't kept going forever.
  if (
    agent === "cursor"
      ? input.status !== undefined && input.status !== "completed"
      : input.stop_hook_active === true
  )
    return EXIT.ok;
  // stdout is the agent's channel; the check's own diagnostics go to stderr.
  const quiet: IO = { ...io, cwd: workingDir(io, input), stdout: io.stderr };
  const checked = await checkForAgent(quiet);
  if (!checked.ok) {
    eprintln(io, `Groundrule: ${checked.message}`);
    return EXIT.ok;
  }
  if (checked.report.failed) {
    const reason = checked.report.text.slice(0, 9_000);
    io.stdout.write(
      `${JSON.stringify(agent === "cursor" ? { followup_message: reason } : { decision: "block", reason })}\n`,
    );
  }
  // The agent has its answer; the workspace gets the counts (RFC 0012), never a path.
  const session = [input.session_id, input.conversation_id].find((v) => typeof v === "string");
  await reportAgentCheck(quiet, checked, {
    name: agent,
    via: "hook",
    ...(typeof session === "string" && session ? { sessionId: session } : {}),
  });
  return EXIT.ok;
}
