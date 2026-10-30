// Action policies (RFC 0017): what a coding agent may do on its own, what needs a person, and
// what is refused. A Standard evaluates an artefact after the fact; an ActionPolicy evaluates an
// intended operation (a shell command, an edit, a read, a fetch, an MCP tool call) before it
// happens, in the agent's own before-tool hook. Both share one envelope.
import { z } from "zod";
import { ApiVersion, Glob, Severity, StandardId } from "./common.js";
import {
  AgentDelivery,
  ComplianceMapping,
  ExceptionPolicy,
  Reference,
  Rollout,
  Scope,
  StandardStatus,
} from "./standard.js";

/** The kinds of operation an agent can intend. `other` is any tool the hook cannot classify. */
export const ACTION_KINDS = ["shell", "edit", "read", "fetch", "mcp", "other"] as const;
export const ActionKind = z
  .enum(ACTION_KINDS)
  .describe(
    "shell: a command. edit: writing a file. read: reading a file. fetch: a web request. mcp: a tool on an MCP server. other: any other tool.",
  );
export type ActionKind = z.infer<typeof ActionKind>;

/** What the hook answers when the policy matches, from least to most strict. */
export const ACTION_EFFECTS = ["allow", "ask", "deny"] as const;
export const ActionEffect = z
  .enum(ACTION_EFFECTS)
  .describe(
    "allow: the agent may proceed without a prompt. ask: a person confirms first. deny: refused, with the reason.",
  );
export type ActionEffect = z.infer<typeof ActionEffect>;

/** Compare two effects. Negative when a is less strict than b, zero when equal, positive otherwise. */
export function compareActionEffect(a: ActionEffect, b: ActionEffect): number {
  return ACTION_EFFECTS.indexOf(a) - ACTION_EFFECTS.indexOf(b);
}

/** A glob over a command segment, host, server or tool name: `*` matches anything, `?` one character. */
const Pattern = z.string().min(1).max(500);

/**
 * What the policy matches. Every listed field narrows the match; within a field any pattern
 * matches. At least one field is required, so a policy can never match everything by accident.
 */
export const ActionMatch = z
  .strictObject({
    actions: z
      .array(ActionKind)
      .min(1)
      .optional()
      .describe("Kinds of operation the policy applies to. Omitted: every kind."),
    commands: z
      .array(Pattern)
      .min(1)
      .optional()
      .describe(
        'Globs over each segment of a shell command (split on &&, ||, ;, | and newlines), e.g. "git push --force*". `*` matches spaces and slashes too.',
      ),
    paths: z
      .array(Glob)
      .min(1)
      .optional()
      .describe("Globs over the repository-relative path of the file an edit or read touches."),
    hosts: z
      .array(Pattern)
      .min(1)
      .optional()
      .describe('Globs over the host of a fetched URL, e.g. "*.internal".'),
    servers: z.array(Pattern).min(1).optional().describe("Globs over the MCP server name."),
    tools: z
      .array(Pattern)
      .min(1)
      .optional()
      .describe(
        "Globs over the tool name as the agent reports it (Bash, Edit, mcp__github__create_issue, apply_patch…); for MCP, also the tool's own name.",
      ),
  })
  .refine((m) => Object.values(m).some((v) => v !== undefined), {
    message: "List at least one of actions, commands, paths, hosts, servers or tools",
  })
  .describe("What the policy matches. Every listed field narrows it.");
export type ActionMatch = z.infer<typeof ActionMatch>;

export const ActionPolicyMetadata = z.strictObject({
  id: StandardId.describe(
    "Unique, stable identifier in the same space as standards, e.g. ACT-001, so exceptions can name it.",
  ),
  title: z.string().min(1).max(120),
  status: StandardStatus.default("active"),
  version: z.number().int().positive().default(1).describe("Bump on every semantic change."),
  owner: z
    .string()
    .min(1)
    .optional()
    .describe("Who owns and can change this policy, e.g. team:platform."),
  category: z.string().min(1).optional().describe("Free-form grouping, e.g. git, infrastructure."),
  labels: z.array(z.string().min(1)).optional(),
});
export type ActionPolicyMetadata = z.infer<typeof ActionPolicyMetadata>;

export const ActionPolicySpec = z.strictObject({
  severity: Severity.describe("How much a breach matters, for evidence and agent files."),
  scope: Scope.default({}).describe(
    "Where the policy applies: repositories and tags; paths and exclude narrow file actions only.",
  ),
  intent: z.string().min(1).optional().describe("Why the policy exists, in one or two lines."),
  requirement: z
    .string()
    .min(1)
    .describe("What the agent must or must not do, and what to do instead. Shown as the reason."),
  effect: ActionEffect.default("ask").describe("What the hook answers when the policy matches."),
  when: ActionMatch,
  agent: AgentDelivery.default({ instruction: true }),
  exceptions: ExceptionPolicy.optional(),
  references: z.array(Reference).optional(),
  compliance: z
    .array(ComplianceMapping)
    .optional()
    .describe("Compliance controls this policy supports (evidence, not certification)."),
  rollout: Rollout.optional().describe("Recommended starting stage when adopting."),
});
export type ActionPolicySpec = z.infer<typeof ActionPolicySpec>;

export const ActionPolicy = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("ActionPolicy"),
    metadata: ActionPolicyMetadata,
    spec: ActionPolicySpec,
  })
  .describe(
    "An action policy: what a coding agent may do on its own, what needs a person, and what is refused. RFC 0017.",
  );
export type ActionPolicy = z.infer<typeof ActionPolicy>;
export type ActionPolicyInput = z.input<typeof ActionPolicy>;

/**
 * An agent action report (RFC 0017): one `ask` or `deny` decision, sent from a repository
 * connected to the platform. The kind of action and the policies that matched; never the
 * command, the path, the URL, the tool's arguments, or anything the agent or developer wrote.
 */
export const AgentAction = z.strictObject({
  apiVersion: ApiVersion,
  kind: z.literal("AgentAction"),
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
    name: z.string().min(1).max(60).describe("The agent whose hook ran, lower-cased."),
    via: z.literal("hook"),
    session: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe("sha256 of the agent's session id."),
  }),
  action: ActionKind,
  decision: z.enum(["ask", "deny"]).describe("What the agent was told."),
  policies: z
    .array(z.strictObject({ id: StandardId, effect: ActionEffect }))
    .min(1)
    .max(50)
    .describe("The policies that matched."),
});
export type AgentAction = z.infer<typeof AgentAction>;
