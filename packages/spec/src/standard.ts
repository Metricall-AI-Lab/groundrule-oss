import { z } from "zod";
import { ApiVersion, Confidence, Glob, Severity, StandardId } from "./common.js";

/** The semantic kind of a standard. Drives defaults and how it is presented. */
export const STANDARD_TYPES = [
  "guidance",
  "requirement",
  "prohibition",
  "invariant",
  "approved-tech",
  "forbidden-tech",
  "process",
  "repository",
  "agent-instruction",
] as const;
export const StandardType = z.enum(STANDARD_TYPES);
export type StandardType = z.infer<typeof StandardType>;

/**
 * Lifecycle status. Review and approval happen through pull requests on the
 * standards repository, so the file itself only records the published state.
 */
export const STANDARD_STATUSES = ["draft", "active", "deprecated", "retired"] as const;
export const StandardStatus = z.enum(STANDARD_STATUSES);
export type StandardStatus = z.infer<typeof StandardStatus>;

/**
 * Where a standard applies. Every field narrows the scope; omitted fields do not
 * restrict it. An empty scope applies everywhere.
 */
export const Scope = z
  .strictObject({
    repositories: z.array(Glob).optional().describe("Repository name globs, e.g. backend-*."),
    paths: z.array(Glob).optional().describe("Path globs the standard applies to."),
    exclude: z.array(Glob).optional().describe("Path globs excluded even if matched by paths."),
    languages: z.array(z.string().min(1)).optional().describe("e.g. java, typescript."),
    frameworks: z.array(z.string().min(1)).optional().describe("e.g. spring-boot, react."),
    tags: z
      .array(z.string().min(1))
      .optional()
      .describe("Repository tags declared in config, e.g. multi-tenant."),
  })
  .describe("Where the standard applies. Omitted fields do not restrict scope.");
export type Scope = z.infer<typeof Scope>;

/** A code example: either a bare snippet or a snippet with context. */
export const Example = z.union([
  z.string().min(1),
  z.strictObject({
    code: z.string().min(1),
    language: z.string().optional(),
    note: z.string().optional(),
  }),
]);
export type Example = z.infer<typeof Example>;

export const Examples = z.strictObject({
  approved: z.array(Example).optional(),
  forbidden: z.array(Example).optional(),
});
export type Examples = z.infer<typeof Examples>;

/** How the standard is delivered to coding agents. */
export const AgentDelivery = z.strictObject({
  instruction: z
    .boolean()
    .default(true)
    .describe("Include this standard in generated agent context (AGENTS.md, CLAUDE.md, ...)."),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe("One or two sentences written for an agent. Defaults to the requirement."),
});
export type AgentDelivery = z.infer<typeof AgentDelivery>;

/**
 * One automated check. `evaluator` selects the plugin; every other key is an
 * option validated by that evaluator's own schema, so this object is open.
 */
export const Check = z
  .looseObject({
    evaluator: z
      .string()
      .regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/, "Evaluator IDs are lowercase, e.g. semgrep")
      .describe("Evaluator plugin ID, e.g. dependencies, semgrep, llm."),
    minConfidence: Confidence.optional().describe(
      "Findings below this confidence are reported as concerns, not violations.",
    ),
  })
  .describe("An automated check. Extra keys are options for the selected evaluator.");
export type Check = z.infer<typeof Check>;

export const ExceptionPolicy = z.strictObject({
  allowed: z.boolean().default(true),
  approvers: z
    .array(z.string().min(1))
    .optional()
    .describe("Who may approve exceptions, e.g. team:security-engineering."),
  maxDurationDays: z.number().int().positive().optional(),
});
export type ExceptionPolicy = z.infer<typeof ExceptionPolicy>;

export const StandardMetadata = z.strictObject({
  id: StandardId,
  title: z.string().min(1).max(120),
  type: StandardType,
  status: StandardStatus.default("active"),
  version: z.number().int().positive().default(1).describe("Bump on every semantic change."),
  owner: z
    .string()
    .min(1)
    .optional()
    .describe("Who owns and can change this standard, e.g. team:security-engineering."),
  category: z.string().min(1).optional().describe("Free-form grouping, e.g. security, data."),
  labels: z.array(z.string().min(1)).optional(),
});
export type StandardMetadata = z.infer<typeof StandardMetadata>;

export const StandardSpec = z.strictObject({
  severity: Severity,
  scope: Scope.default({}),
  intent: z.string().min(1).optional().describe("Why the standard exists, in one or two lines."),
  rationale: z.string().min(1).optional().describe("Longer background, trade-offs, history."),
  requirement: z.string().min(1).describe("What must (or must not) be true. Be specific."),
  examples: Examples.optional(),
  remediation: z.string().min(1).optional().describe("How to fix a violation."),
  agent: AgentDelivery.default({ instruction: true }),
  checks: z.array(Check).default([]).describe("Automated checks. Empty means guidance only."),
  exceptions: ExceptionPolicy.optional(),
  references: z.array(z.url()).optional().describe("Links to ADRs, docs, incidents."),
});
export type StandardSpec = z.infer<typeof StandardSpec>;

export const Standard = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("Standard"),
    metadata: StandardMetadata,
    spec: StandardSpec,
  })
  .describe("A Groundrule standard: one engineering rule with scope, intent, and checks.");
export type Standard = z.infer<typeof Standard>;
export type StandardInput = z.input<typeof Standard>;
