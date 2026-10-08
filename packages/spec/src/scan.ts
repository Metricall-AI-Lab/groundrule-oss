import { z } from "zod";
import { ApiVersion, Severity, StandardId } from "./common.js";

/** Coding-agent instruction files `groundrule scan` recognizes. */
export const AGENT_FILE_KINDS = [
  "agents-md",
  "claude-md",
  "claude-rules",
  "cursor-rules",
  "cursorrules",
  "copilot-instructions",
  "copilot-path-instructions",
  "gemini-md",
  "windsurf-rules",
  "aider-conventions",
] as const;
export const AgentFileKind = z.enum(AGENT_FILE_KINDS);
export type AgentFileKind = z.infer<typeof AgentFileKind>;

/** How a catalog rule came out on a repository, observed without enforcing anything. */
export const SCAN_OUTCOMES = [
  "clean",
  "violations",
  "guidance",
  "not-applicable",
  "not-evaluable",
] as const;
export const ScanOutcome = z.enum(SCAN_OUTCOMES);
export type ScanOutcome = z.infer<typeof ScanOutcome>;

const RelPath = z.string().min(1).max(400).describe("Repository-relative POSIX path.");
const Count = z.number().int().nonnegative().max(10_000_000);

export const ScanAgentFile = z.strictObject({
  path: RelPath,
  kind: AgentFileKind,
  lines: Count,
  bytes: Count,
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .describe("Content hash, to notice changes."),
  managed: z.boolean().describe("Contains a block written by `groundrule sync`."),
  headings: Count,
  bullets: Count,
});
export type ScanAgentFile = z.infer<typeof ScanAgentFile>;

export const ScanTool = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(40)
    .describe("Tool, e.g. eslint, ruff, codeowners."),
  path: RelPath,
  facts: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((r) => Object.keys(r).length <= 10, "At most 10 facts")
    .default({})
    .describe("A few configuration facts, e.g. { strict: true }. Never file contents."),
});
export type ScanTool = z.infer<typeof ScanTool>;

export const ScanExample = z.strictObject({
  file: RelPath.optional(),
  line: z.number().int().positive().optional(),
  message: z.string().min(1).max(300),
  snippet: z
    .string()
    .max(200)
    .optional()
    .describe("One line of code, secrets redacted. Omitted for secret-detection rules."),
});
export type ScanExample = z.infer<typeof ScanExample>;

export const ScanRule = z.strictObject({
  id: StandardId,
  version: z.number().int().positive(),
  pack: z
    .string()
    .min(1)
    .max(120)
    .describe("Where the rule comes from, e.g. groundrule:packs/python."),
  severity: Severity,
  outcome: ScanOutcome,
  findings: Count,
  filesInScope: Count.describe("Files the rule looks at in this repository."),
  filesAffected: Count.describe("Files with at least one finding."),
  examples: z.array(ScanExample).max(3).default([]),
  reason: z.string().max(300).optional(),
});
export type ScanRule = z.infer<typeof ScanRule>;

/**
 * What `groundrule scan` learned about a repository: its stack, existing agent files and
 * tool configurations, and how every applicable catalog rule would do today. It holds
 * counts and at most a few one-line snippets per rule, never whole files.
 */
export const ScanReport = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("ScanReport"),
    metadata: z.strictObject({
      generatedAt: z.iso.datetime({ offset: true }),
      cliVersion: z.string().min(1).max(40),
      durationMs: Count,
      snippets: z.boolean().describe("Whether code snippets were included."),
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
      files: Count,
    }),
    stack: z.strictObject({
      languages: z.array(z.string().min(1).max(40)).max(40),
      frameworks: z.array(z.string().min(1).max(40)).max(40),
    }),
    agentFiles: z.array(ScanAgentFile).max(100),
    tools: z.array(ScanTool).max(100),
    rules: z.array(ScanRule).max(2000),
    summary: z.strictObject({
      rules: Count,
      clean: Count,
      violations: Count,
      guidance: Count,
      notApplicable: Count,
      notEvaluable: Count,
      findings: Count,
    }),
  })
  .describe("A repository scan, produced by `groundrule scan` and uploaded with --upload.");
export type ScanReport = z.infer<typeof ScanReport>;
