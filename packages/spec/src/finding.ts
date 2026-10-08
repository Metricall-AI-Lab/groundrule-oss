import { z } from "zod";
import { Confidence, Severity, StandardId } from "./common.js";

/** Where a finding's verdict came from. Always shown to users. */
export const FINDING_SOURCES = ["deterministic", "static-analysis", "ai", "external"] as const;
export const FindingSource = z.enum(FINDING_SOURCES);
export type FindingSource = z.infer<typeof FindingSource>;

/**
 * violation: the standard is not met.
 * concern: possibly not met, below the confidence needed to call it a violation.
 * pass: evaluated and met.
 * not-evaluable: the evaluator could not decide (unsupported language, missing tool, ...).
 */
export const FINDING_STATUSES = ["violation", "concern", "pass", "not-evaluable"] as const;
export const FindingStatus = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof FindingStatus>;

export const Location = z.strictObject({
  file: z.string().min(1).describe("Repository-relative POSIX path."),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  startColumn: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
});
export type Location = z.infer<typeof Location>;

export const Finding = z
  .strictObject({
    standardId: StandardId,
    standardVersion: z.number().int().positive(),
    evaluator: z.string().min(1),
    source: FindingSource,
    status: FindingStatus,
    severity: Severity,
    confidence: Confidence,
    location: Location.optional(),
    message: z.string().min(1).describe("One sentence: what is wrong."),
    evidence: z.array(z.string().min(1)).default([]).describe("Why the evaluator believes this."),
    remediation: z.string().min(1).optional(),
    isNew: z
      .boolean()
      .describe("True if introduced by the change under evaluation, false if legacy."),
    suppressedBy: z
      .string()
      .optional()
      .describe("ID of the exception that suppresses this finding, if any."),
    fingerprint: z
      .string()
      .min(1)
      .describe("Stable identity across runs, used for dedupe, baselines, and feedback."),
  })
  .describe("The result of evaluating one standard against one location.");
export type Finding = z.infer<typeof Finding>;
