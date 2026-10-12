import { z } from "zod";
import { CheckRunPullRequest } from "./check-run.js";
import { ApiVersion, StandardId } from "./common.js";
import { AgentTarget } from "./config.js";

const RelPath = z.string().min(1).max(400).describe("Repository-relative POSIX path.");
const Count = z.number().int().nonnegative().max(10_000_000);

/**
 * current: matches the rulebook. outdated: exists but differs. missing: should exist.
 * leftover: a file Groundrule generated earlier that should now be removed.
 */
export const AGENT_FILE_STATUSES = ["current", "outdated", "missing", "leftover"] as const;
export const AgentFileStatus = z.enum(AGENT_FILE_STATUSES);
export type AgentFileStatus = z.infer<typeof AgentFileStatus>;

/** Coding agents with a project-level "agent is finishing" hook (`groundrule hooks`). */
export const HOOK_AGENTS = ["claude-code", "codex", "cursor", "copilot"] as const;
export const HookAgent = z.enum(HOOK_AGENTS);
export type HookAgent = z.infer<typeof HookAgent>;

/** Where a project can configure an MCP server: Claude Code (.mcp.json), Cursor, VS Code. */
export const MCP_CLIENTS = ["claude-code", "cursor", "vscode"] as const;
export const McpClient = z.enum(MCP_CLIENTS);
export type McpClient = z.infer<typeof McpClient>;

/**
 * What a repository delivers to coding agents, as sent by `groundrule sync --upload`
 * (RFC 0006): which agent files it writes and whether they match the rulebook, which rules
 * they carry, and whether the repository has Groundrule's stop hooks and MCP server set up.
 * Paths, rule IDs and yes/no only; never file contents.
 */
export const AgentSync = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("AgentSync"),
    metadata: z.strictObject({
      generatedAt: z.iso.datetime({ offset: true }),
      cliVersion: z.string().min(1).max(40),
    }),
    repository: z.strictObject({
      name: z
        .string()
        .min(1)
        .max(200)
        .describe("owner/name from the git remote, or the folder name."),
      commit: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .optional(),
      branch: z.string().min(1).max(255).optional(),
    }),
    pullRequest: CheckRunPullRequest.optional().describe(
      "Present when the report came from CI for a pull request.",
    ),
    rulebook: z
      .enum(["platform", "local"])
      .describe("platform: the organization's rulebook on Groundrule. local: packs in the config."),
    upToDate: z.boolean().describe("Every agent file matches the rulebook."),
    targets: z
      .array(
        z.strictObject({
          target: AgentTarget,
          files: z.array(z.strictObject({ path: RelPath, status: AgentFileStatus })).max(100),
        }),
      )
      .max(10)
      .describe("The agent formats the config asks for, and their files."),
    standards: z.strictObject({
      delivered: Count.describe("Rules written into the agent files."),
      ids: z.array(StandardId).max(2000).describe("Their IDs, in order."),
    }),
    hooks: z
      .array(z.strictObject({ agent: HookAgent, installed: z.boolean() }))
      .max(10)
      .describe("Whether the repository's project settings run `groundrule hook` for each agent."),
    mcp: z
      .array(z.strictObject({ client: McpClient, configured: z.boolean() }))
      .max(10)
      .describe(
        "Whether the repository's project MCP settings start `groundrule mcp`. Settings in a developer's own profile can't be seen.",
      ),
  })
  .describe(
    "What a repository delivers to coding agents, uploaded with `groundrule sync --upload`.",
  );
export type AgentSyncInput = z.input<typeof AgentSync>;
export type AgentSync = z.infer<typeof AgentSync>;
