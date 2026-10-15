// An agent check report (RFC 0012): what the stop hook or the MCP `check` tool found, as
// counts per rule, sent from a repository connected to the platform. Never a path, a line, a
// snippet, or anything the agent or the developer wrote.
import { z } from "zod";
import { ApiVersion, Severity, StandardId } from "./common.js";

const Count = z.number().int().nonnegative().max(1_000_000);

export const AGENT_CHECK_VIAS = ["hook", "mcp"] as const;

export const AgentCheckFinding = z.strictObject({
  id: StandardId,
  severity: Severity,
  count: Count.min(1).describe("Findings of this rule the agent was told about."),
  blocking: z.boolean().describe("Counted toward the agent being stopped."),
});
export type AgentCheckFinding = z.infer<typeof AgentCheckFinding>;

export const AgentCheck = z.strictObject({
  apiVersion: ApiVersion,
  kind: z.literal("AgentCheck"),
  metadata: z.strictObject({
    generatedAt: z.iso.datetime({ offset: true }),
    cliVersion: z.string().min(1).max(40),
  }),
  repository: z.strictObject({
    name: z
      .string()
      .min(1)
      .max(200)
      .describe("As registered in Groundrule, e.g. acme/payments-api."),
  }),
  agent: z.strictObject({
    name: z
      .string()
      .min(1)
      .max(60)
      .describe("The agent whose hook ran, or the MCP client's name, lower-cased."),
    via: z.enum(AGENT_CHECK_VIAS),
    client: z
      .strictObject({ name: z.string().min(1).max(80), version: z.string().max(40).optional() })
      .optional()
      .describe("MCP clients only, as they introduce themselves."),
    session: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe("sha256 of the agent's session id, so one turn's repeats count once."),
  }),
  check: z.strictObject({
    mode: z.enum(["changes", "all"]),
    base: z.string().min(1).max(200).optional(),
    files: Count.describe("Files checked."),
    standards: Count.describe("Rules evaluated."),
    durationMs: Count,
  }),
  findings: z.array(AgentCheckFinding).max(200).describe("Rules that found something."),
  stopped: z.boolean().describe("The hook blocked the agent, or the tool reported a failure."),
});
export type AgentCheck = z.infer<typeof AgentCheck>;
