import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { HOOK_AGENTS, type HookAgent } from "@groundrule/spec";
import { checkForAgent } from "../agent-report.js";
import { EXIT, eprintln, type IO, println, style } from "../io.js";

export { HOOK_AGENTS, type HookAgent };

/** Where each agent reads project hooks from. */
const HOOK_FILE: Record<HookAgent, string> = {
  "claude-code": ".claude/settings.json",
  codex: ".codex/hooks.json",
  cursor: ".cursor/hooks.json",
};

const NAME: Record<HookAgent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

// A bare package name lets npx reuse an older cached CLI without the hook command.
const command = (agent: HookAgent) => `npx --yes '@groundrule/cli@>=0.4.0' hook ${agent}`;
/** Recognizes a hook this command installed, whatever version wrote it. */
const OURS = /(^|[\s'"])(@groundrule\/cli|groundrule)(@[^\s'"]+)?['"]?\s+hook\s/;
/** Seconds an agent waits for the check before giving up on it. */
const TIMEOUT = 120;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const commandOf = (v: unknown) => (isObject(v) && typeof v.command === "string" ? v.command : "");

/**
 * Add (or remove) Groundrule's stop hook in an agent's hook config, keeping everything else.
 * Claude Code and Codex share one shape: hooks.Stop[] of { hooks: [{ type, command }] }.
 * Cursor's is version 1 with hooks.stop[] of { command }.
 */
export function withHook(config: Json, agent: HookAgent, install: boolean): Json {
  const hooks = isObject(config.hooks) ? { ...config.hooks } : {};
  if (agent === "cursor") {
    const stop = (Array.isArray(hooks.stop) ? hooks.stop : []).filter(
      (h) => !OURS.test(commandOf(h)),
    );
    // One follow-up per turn: the agent fixes what it can, and then it may stop.
    if (install) stop.push({ command: command(agent), timeout: TIMEOUT, loop_limit: 1 });
    if (stop.length) hooks.stop = stop;
    else delete hooks.stop;
    return tidy(
      { version: typeof config.version === "number" ? config.version : 1, ...config },
      hooks,
    );
  }
  const groups = (Array.isArray(hooks.Stop) ? hooks.Stop : [])
    .map((g) =>
      isObject(g) && Array.isArray(g.hooks)
        ? { ...g, hooks: g.hooks.filter((h) => !OURS.test(commandOf(h))) }
        : g,
    )
    .filter((g) => !(isObject(g) && Array.isArray(g.hooks) && g.hooks.length === 0));
  if (install)
    groups.push({ hooks: [{ type: "command", command: command(agent), timeout: TIMEOUT }] });
  if (groups.length) hooks.Stop = groups;
  else delete hooks.Stop;
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
    HOOK_AGENTS.filter((a) => a === "claude-code" || existsSync(join(root, dirname(HOOK_FILE[a]))));
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
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
    println(
      io,
      options.remove
        ? `${s.green("✓")} Removed the Groundrule hook from ${file}`
        : `${s.green("✓")} ${NAME[agent]} checks its work when it finishes: ${file}`,
    );
  }
  if (!options.remove && changed && code === EXIT.ok)
    println(
      io,
      `\nCommit ${agents.length === 1 ? "this file" : "these files"} so everyone's agent runs the check. ${agents.includes("codex") ? "Codex asks each developer to trust the hook once (/hooks). " : ""}Remove with \`groundrule hooks --remove\`.`,
    );
  return code;
}

interface HookInput {
  cwd?: unknown;
  stop_hook_active?: unknown;
  status?: unknown;
  workspace_roots?: unknown;
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
export async function hook(io: IO, agent: HookAgent): Promise<number> {
  let input: HookInput = {};
  try {
    // An agent pipes the event in; a person running it in a terminal doesn't.
    const piped = io.stdin && !(io.stdin as { isTTY?: boolean }).isTTY;
    const parsed: unknown = piped && io.stdin ? JSON.parse((await readAll(io.stdin)) || "{}") : {};
    if (isObject(parsed)) input = parsed;
  } catch {
    // An agent that sends no JSON still gets checked.
  }
  // Ask once per turn, so an agent that can't fix something isn't kept going forever.
  if (
    agent === "cursor"
      ? input.status !== undefined && input.status !== "completed"
      : input.stop_hook_active === true
  )
    return EXIT.ok;
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
  const dir =
    typeof input.cwd === "string" ? input.cwd : typeof roots[0] === "string" ? roots[0] : undefined;
  // stdout is the agent's channel; the check's own diagnostics go to stderr.
  const quiet: IO = { ...io, cwd: dir ? resolve(io.cwd, dir) : io.cwd, stdout: io.stderr };
  const checked = await checkForAgent(quiet);
  if (!checked.ok) {
    eprintln(io, `Groundrule: ${checked.message}`);
    return EXIT.ok;
  }
  if (!checked.report.failed) return EXIT.ok;
  const reason = checked.report.text.slice(0, 9_000);
  io.stdout.write(
    `${JSON.stringify(agent === "cursor" ? { followup_message: reason } : { decision: "block", reason })}\n`,
  );
  return EXIT.ok;
}
