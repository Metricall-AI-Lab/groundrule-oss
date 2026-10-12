// What a repository delivers to coding agents, shaped for upload (RFC 0006): agent files and
// whether they match the rulebook, the rules they carry, and whether the stop hooks and the
// MCP server are set up. Paths, rule IDs and yes/no only; never file contents.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type AgentFileStatus,
  type AgentSync,
  type AgentTarget,
  API_VERSION,
  type CheckRunPullRequest,
  MCP_CLIENTS,
  type McpClient,
} from "@groundrule/spec";
import { installedHooks } from "./commands/hooks.js";

const execFileAsync = promisify(execFile);

async function gitValue(root: string, args: string[]): Promise<string | undefined> {
  try {
    return (await execFileAsync("git", args, { cwd: root })).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Which agent format a generated file belongs to. */
export function targetOf(path: string): AgentTarget | undefined {
  if (path === "AGENTS.md") return "agents-md";
  if (path === "CLAUDE.md") return "claude-code";
  if (path.startsWith(".cursor/")) return "cursor";
  if (path.startsWith(".github/")) return "copilot";
  return undefined;
}

const STATUS: Record<"created" | "updated" | "unchanged" | "removed", AgentFileStatus> = {
  unchanged: "current",
  updated: "outdated",
  created: "missing",
  removed: "leftover",
};

/** Project MCP settings: the file, and the key that holds the servers. */
const MCP_FILE: Record<McpClient, [string, string]> = {
  "claude-code": [".mcp.json", "mcpServers"],
  cursor: [".cursor/mcp.json", "mcpServers"],
  vscode: [".vscode/mcp.json", "servers"],
};
const STARTS_MCP = /(^|\s)(@groundrule\/cli|groundrule)(@\S+)?\s+mcp(\s|$)/;

/** Which clients' project MCP settings in this repository start `groundrule mcp`. */
export async function configuredMcp(
  root: string,
): Promise<{ client: McpClient; configured: boolean }[]> {
  return Promise.all(
    MCP_CLIENTS.map(async (client) => {
      const [file, key] = MCP_FILE[client];
      try {
        const config = JSON.parse(await readFile(join(root, file), "utf8")) as Record<
          string,
          unknown
        >;
        const servers = config?.[key];
        const configured =
          typeof servers === "object" &&
          servers !== null &&
          Object.values(servers).some((server) => {
            const s = server as { command?: unknown; args?: unknown };
            const line = [s.command, ...(Array.isArray(s.args) ? s.args : [])]
              .filter((v): v is string => typeof v === "string")
              .join(" ");
            return STARTS_MCP.test(line);
          });
        return { client, configured };
      } catch {
        return { client, configured: false };
      }
    }),
  );
}

export interface AgentSyncOptions {
  root: string;
  cliVersion: string;
  repositoryName: string;
  rulebook: AgentSync["rulebook"];
  targets: readonly AgentTarget[];
  changes: readonly { path: string; status: keyof typeof STATUS }[];
  standardIds: readonly string[];
  pullRequest?: CheckRunPullRequest | undefined;
  now?: Date;
}

export async function buildAgentSync(options: AgentSyncOptions): Promise<AgentSync> {
  const { root } = options;
  const commit = await gitValue(root, ["rev-parse", "HEAD"]);
  // Pull-request checkouts are detached; their branch comes from the pull request.
  const branch =
    options.pullRequest?.headRef ??
    (await gitValue(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]));
  const targets = [...new Set(options.targets)].map((target) => ({
    target,
    files: options.changes
      .filter((c) => targetOf(c.path) === target)
      .slice(0, 100)
      .map((c) => ({ path: c.path.slice(0, 400), status: STATUS[c.status] })),
  }));
  return {
    apiVersion: API_VERSION,
    kind: "AgentSync",
    metadata: {
      generatedAt: (options.now ?? new Date()).toISOString(),
      cliVersion: options.cliVersion.slice(0, 40),
    },
    repository: {
      name: options.repositoryName.slice(0, 200),
      ...(commit && /^[0-9a-f]{40}$/.test(commit) ? { commit } : {}),
      ...(branch ? { branch: branch.slice(0, 255) } : {}),
    },
    ...(options.pullRequest ? { pullRequest: options.pullRequest } : {}),
    rulebook: options.rulebook,
    upToDate: options.changes.every((c) => c.status === "unchanged"),
    targets,
    standards: { delivered: options.standardIds.length, ids: options.standardIds.slice(0, 2000) },
    hooks: await installedHooks(root),
    mcp: await configuredMcp(root),
  };
}
