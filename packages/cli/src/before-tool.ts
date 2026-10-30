// The before-tool hook (RFC 0017): what an agent is about to do, as its hook reports it, turned
// into an action the kernel can decide on, and the decision turned back into the agent's shape.
// Nothing here reads the repository or executes anything; a problem means no decision.
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type ActionDecision,
  type AgentAction,
  decideAction,
  type MatchedPolicy,
} from "@groundrule/core";
import {
  type ActionKind,
  type AgentAction as AgentActionReport,
  API_VERSION,
} from "@groundrule/spec";
import type { HookAgent } from "./commands/hooks.js";
import { type IO, VERSION } from "./io.js";
import { detectRepository, platformUrl, tokenFor } from "./platform.js";
import type { OpenedWorkspace } from "./workspace.js";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Which hook events each agent sends through `groundrule hook <agent> --before-tool`. */
export const BEFORE_TOOL_EVENTS: Record<HookAgent, readonly string[]> = {
  "claude-code": ["PreToolUse"],
  codex: ["PreToolUse"],
  cursor: ["beforeShellExecution", "beforeMCPExecution", "beforeReadFile"],
  copilot: ["preToolUse"],
};

/** Tool names agents use, lower-cased, to the kind of action. Unknown names are `other`. */
const TOOL_KINDS: Record<string, ActionKind> = {
  bash: "shell",
  powershell: "shell",
  shell: "shell",
  run_terminal_cmd: "shell",
  run_in_terminal: "shell",
  edit: "edit",
  write: "edit",
  multiedit: "edit",
  notebookedit: "edit",
  apply_patch: "edit",
  create: "edit",
  create_file: "edit",
  edit_file: "edit",
  str_replace_editor: "edit",
  read: "read",
  view: "read",
  read_file: "read",
  webfetch: "fetch",
  web_fetch: "fetch",
  fetch: "fetch",
};

const MCP_TOOL = /^mcp__([^_].*?)__(.+)$/;

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** The repository-relative POSIX path of a file; outside the repository, the absolute path. */
async function relativePath(root: string, cwd: string, given: string): Promise<string> {
  const absolute = isAbsolute(given) ? given : resolve(cwd, given);
  // Real paths on both sides: a temp dir or a symlinked checkout must not look outside.
  const real = async (p: string): Promise<string> => {
    try {
      return await realpath(p);
    } catch {
      return join(await real(dirname(p)), basename(p));
    }
  };
  const rel = relative(await real(root), await real(absolute)).replace(/\\/g, "/");
  return !rel || rel.startsWith("../") ? absolute.replace(/\\/g, "/") : rel;
}

/**
 * The action an agent intends, from its hook's input. Claude Code, Codex and Copilot's
 * PascalCase payload share one shape; Copilot's own is camelCase with `toolArgs`; Cursor's
 * depends on the event. Undefined when the event carries nothing to decide on.
 */
export async function actionFromHook(
  agent: HookAgent,
  input: Json,
  root: string,
  cwd: string,
): Promise<AgentAction | undefined> {
  const event = str(input.hook_event_name);
  if (agent === "cursor") {
    if (event === "beforeShellExecution" || (!event && str(input.command) && !input.tool_name))
      return { kind: "shell", tool: "shell", ...cmd(str(input.command)) };
    if (event === "beforeMCPExecution" || (!event && str(input.mcp_server_name))) {
      const tool = str(input.tool_name);
      const server = str(input.mcp_server_name);
      return {
        kind: "mcp",
        ...(tool ? { tool, mcpTool: tool } : {}),
        ...(server ? { server } : {}),
      };
    }
    if (event === "beforeReadFile" || (!event && str(input.file_path) && !input.tool_name)) {
      const path = str(input.file_path);
      return {
        kind: "read",
        tool: "read",
        ...(path ? { path: await relativePath(root, cwd, path) } : {}),
      };
    }
  }
  // Copilot's camelCase payload, or the PascalCase one every other agent sends.
  let toolName = str(input.tool_name) ?? str(input.toolName);
  let args: Json = isObject(input.tool_input) ? input.tool_input : {};
  if (!Object.keys(args).length) {
    const raw = input.toolArgs ?? input.tool_input;
    if (isObject(raw)) args = raw;
    else if (typeof raw === "string")
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isObject(parsed)) args = parsed;
      } catch {
        // Not JSON: nothing to read from it.
      }
  }
  if (!toolName) return undefined;
  toolName = toolName.trim();
  const mcp = MCP_TOOL.exec(toolName);
  if (mcp?.[1] && mcp[2]) return { kind: "mcp", tool: toolName, server: mcp[1], mcpTool: mcp[2] };
  const kind = TOOL_KINDS[toolName.toLowerCase()] ?? "other";
  const action: AgentAction = { kind, tool: toolName };
  if (kind === "shell") Object.assign(action, cmd(str(args.command) ?? str(args.cmd)));
  if (kind === "edit" || kind === "read") {
    const path = str(args.file_path) ?? str(args.path) ?? str(args.filePath);
    if (path) action.path = await relativePath(root, cwd, path);
  }
  if (kind === "fetch") {
    const host = hostOf(str(args.url));
    if (host) action.host = host;
  }
  return action;
}

const cmd = (command: string | undefined) => (command ? { command } : {});

/** Effects an agent can act on; an unsupported `ask` is delivered as deny, never silently open. */
const SUPPORTS_ASK: Record<HookAgent, (input: Json) => boolean> = {
  "claude-code": () => true,
  codex: () => false,
  cursor: (input) => str(input.hook_event_name) !== "beforeReadFile",
  copilot: () => true,
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The reason an agent reads: the policies, what they require, and how to proceed. */
export function reasonText(
  decision: ActionDecision,
  delivered: "allow" | "ask" | "deny",
  downgraded: boolean,
): string {
  const lines: string[] = [];
  const named = (p: MatchedPolicy) =>
    `${p.id} ${p.title} (${p.severity}): ${oneLine(p.summary ?? p.requirement)}`;
  if (delivered === "deny") {
    lines.push(
      downgraded
        ? "Groundrule: this action needs a person, and this agent can't ask, so it is not run. Ask the developer to run it, or do it another way."
        : "Groundrule: this action is not allowed here. Do it another way, or ask the developer.",
    );
  } else if (delivered === "ask") {
    lines.push("Groundrule: this action needs the developer's confirmation.");
  } else {
    lines.push("Groundrule: this action is allowed by policy.");
  }
  for (const p of decision.policies) lines.push(`- ${named(p)}`);
  if (delivered !== "allow")
    lines.push(
      "If the policy is wrong for this repository, say so; a time-boxed exception is written by the team in .groundrule/exceptions.yaml. Never work around it.",
    );
  return lines.join("\n");
}

/** What advising policies (stage advise, or lifted by an exception) say, as context only. */
export function advisoryText(decision: ActionDecision): string | undefined {
  if (!decision.advisory.length) return undefined;
  return [
    "Groundrule: policies that apply to this action (advisory):",
    ...decision.advisory.map(
      (p) =>
        `- ${p.id} ${p.title}: ${oneLine(p.summary ?? p.requirement)}${p.exception ? ` (exception ${p.exception} applies)` : p.stage === "advise" ? " (advise stage: not enforced yet)" : ""}`,
    ),
  ].join("\n");
}

export interface HookAnswer {
  /** The JSON the agent reads, or undefined for "no decision". */
  output?: Json;
  /** What was delivered, for the report. */
  delivered?: "allow" | "ask" | "deny";
  decision: ActionDecision;
}

/** Decide the action and shape the answer for the agent. `extraContext` rides along (ADR 0010). */
export function answerFor(
  agent: HookAgent,
  input: Json,
  workspace: Pick<OpenedWorkspace, "actions" | "exceptions">,
  action: AgentAction,
  target: { repository?: string; tags?: readonly string[] },
  extraContext?: string,
): HookAnswer {
  const decision = decideAction(workspace.actions, workspace.exceptions, action, target);
  const advisory = advisoryText(decision);
  const context = [extraContext, advisory].filter(Boolean).join("\n\n") || undefined;
  if (!decision.effect) {
    const output = context ? contextOnly(agent, input, context) : undefined;
    return output ? { decision, output } : { decision };
  }
  const downgraded = decision.effect === "ask" && !SUPPORTS_ASK[agent](input);
  const delivered = downgraded ? "deny" : decision.effect;
  const reason = reasonText(decision, delivered, downgraded);
  return { decision, delivered, output: shape(agent, input, delivered, reason, context) };
}

function contextOnly(agent: HookAgent, input: Json, context: string): Json | undefined {
  if (agent === "claude-code" || agent === "codex")
    return {
      hookSpecificOutput: {
        hookEventName: str(input.hook_event_name) ?? "PreToolUse",
        additionalContext: context,
      },
    };
  // Cursor's before-* hooks and Copilot's preToolUse have no context channel.
  return undefined;
}

function shape(
  agent: HookAgent,
  input: Json,
  delivered: "allow" | "ask" | "deny",
  reason: string,
  context: string | undefined,
): Json {
  if (agent === "claude-code" || agent === "codex")
    return {
      hookSpecificOutput: {
        hookEventName: str(input.hook_event_name) ?? "PreToolUse",
        permissionDecision: delivered,
        permissionDecisionReason: reason,
        ...(context ? { additionalContext: context } : {}),
      },
    };
  if (agent === "cursor")
    return {
      permission: delivered,
      agent_message: reason,
      user_message: reason.split("\n")[0] ?? reason,
    };
  return { permissionDecision: delivered, permissionDecisionReason: reason };
}

/** Seconds a report may take; the agent is never kept waiting longer. */
const REPORT_TIMEOUT_MS = 2_000;

/** The report an `ask` or `deny` sends to the workspace (RFC 0017): kinds and ids, nothing else. */
export function agentActionDocument(
  repository: string,
  agent: HookAgent,
  sessionId: string | undefined,
  action: AgentAction,
  delivered: "ask" | "deny",
  decision: ActionDecision,
): AgentActionReport {
  return {
    apiVersion: API_VERSION,
    kind: "AgentAction",
    metadata: { generatedAt: new Date().toISOString(), cliVersion: VERSION },
    repository: { name: repository },
    agent: {
      name: agent,
      via: "hook",
      ...(sessionId ? { session: createHash("sha256").update(sessionId).digest("hex") } : {}),
    },
    action: action.kind,
    decision: delivered,
    policies: decision.policies.slice(0, 50).map((p) => ({ id: p.id, effect: p.effect })),
  };
}

/** Fire and forget, like the check reports (RFC 0012). */
export async function reportAgentAction(
  io: IO,
  workspace: OpenedWorkspace,
  agent: HookAgent,
  sessionId: string | undefined,
  action: AgentAction,
  delivered: "ask" | "deny",
  decision: ActionDecision,
): Promise<boolean> {
  const { config, root } = workspace;
  const platform = config.platform;
  if (!platform || platform.reports === "none") return false;
  try {
    const url = platformUrl(io, undefined, config);
    const auth = await tokenFor(io, url, platform.org);
    if (!auth) return false;
    const repository =
      workspace.platform?.rulebook.target.repository?.name ??
      platform.repository ??
      (await detectRepository(root));
    if (!repository) return false;
    const document = agentActionDocument(repository, agent, sessionId, action, delivered, decision);
    const doFetch = io.fetch ?? fetch;
    await doFetch(`${url}/api/v1/cli/agent-actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `groundrule-cli/${VERSION}`,
        authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}
