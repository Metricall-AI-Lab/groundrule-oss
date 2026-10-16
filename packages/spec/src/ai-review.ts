// AI review requests (RFC 0013): what a hosted check hands to the model for the rules with an
// `llm` check, written by `groundrule check --ai-requests` inside the sandbox and answered
// outside it. Changed lines with a little context, secrets redacted; never whole files.
import { z } from "zod";
import { ApiVersion, Severity, StandardId } from "./common.js";

export const AI_CONFIDENCE_LEVELS = ["medium", "high"] as const;
export const AiConfidenceLevel = z.enum(AI_CONFIDENCE_LEVELS);
export type AiConfidenceLevel = z.infer<typeof AiConfidenceLevel>;

export const AiReviewHunk = z.strictObject({
  startLine: z.number().int().positive().describe("Line number of the first line below."),
  lines: z.array(z.string().max(2_000)).min(1).max(1_000),
});
export type AiReviewHunk = z.infer<typeof AiReviewHunk>;

export const AiReviewRequest = z.strictObject({
  standardId: StandardId,
  standardVersion: z.number().int().positive(),
  title: z.string().min(1).max(200),
  requirement: z.string().min(1).max(4_000),
  severity: Severity,
  question: z.string().min(1).max(2_000),
  minConfidence: AiConfidenceLevel,
  file: z.string().min(1).max(400),
  language: z.string().min(1).max(40).optional(),
  hunks: z.array(AiReviewHunk).min(1).max(200),
});
export type AiReviewRequest = z.infer<typeof AiReviewRequest>;

export const AiReviewRequests = z.strictObject({
  apiVersion: ApiVersion,
  kind: z.literal("AiReviewRequests"),
  metadata: z.strictObject({
    generatedAt: z.iso.datetime({ offset: true }),
    cliVersion: z.string().min(1).max(40),
  }),
  requests: z.array(AiReviewRequest).max(500),
  /** What the limits left out, so the run can say so. */
  skipped: z.strictObject({
    files: z.number().int().nonnegative().describe("Files past the per-run limits."),
    standards: z
      .array(StandardId)
      .max(500)
      .describe("Rules with an llm check that had something to review but were cut."),
  }),
});
export type AiReviewRequests = z.infer<typeof AiReviewRequests>;
