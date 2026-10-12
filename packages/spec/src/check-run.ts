import { z } from "zod";
import { ApiVersion, Severity, StandardId } from "./common.js";
import { FindingSource } from "./finding.js";

const RelPath = z.string().min(1).max(400).describe("Repository-relative POSIX path.");
const Count = z.number().int().nonnegative().max(10_000_000);

/** How one standard came out in a check run. */
export const CHECK_OUTCOMES = [
  "passed",
  "failed",
  "warned",
  "not-evaluable",
  "guidance",
  "skipped",
] as const;
export const CheckOutcome = z.enum(CHECK_OUTCOMES);
export type CheckOutcome = z.infer<typeof CheckOutcome>;

export const CheckRunOutcome = z.strictObject({
  id: StandardId,
  title: z.string().min(1).max(200),
  severity: Severity,
  status: CheckOutcome,
  violations: Count,
  concerns: Count,
});
export type CheckRunOutcome = z.infer<typeof CheckRunOutcome>;

export const CheckRunFinding = z.strictObject({
  standardId: StandardId,
  severity: Severity,
  status: z.enum(["violation", "concern"]),
  source: FindingSource,
  blocking: z.boolean().describe("This finding fails the run."),
  isNew: z.boolean().describe("Introduced by the change under evaluation, not legacy."),
  file: RelPath.optional(),
  line: z.number().int().positive().optional(),
  message: z.string().min(1).max(300),
  snippet: z
    .string()
    .max(200)
    .optional()
    .describe("The offending line, credential-shaped values redacted. Omitted with --no-snippets."),
});
export type CheckRunFinding = z.infer<typeof CheckRunFinding>;

export const CheckRunPullRequest = z.strictObject({
  number: z.number().int().positive(),
  title: z.string().min(1).max(300).optional(),
  url: z
    .url({ protocol: /^https$/ })
    .max(500)
    .optional()
    .describe("The pull request on the code host."),
  headRef: z.string().min(1).max(255).optional().describe("The branch being merged."),
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional()
    .describe(
      "The pull request's head commit, where the code host shows checks. CI often checks out a test merge commit instead (repository.commit).",
    ),
  baseRef: z.string().min(1).max(255).optional().describe("The branch merged into."),
  author: z.string().min(1).max(100).optional().describe("The author's login on the code host."),
});
export type CheckRunPullRequest = z.infer<typeof CheckRunPullRequest>;

/**
 * The result of one `groundrule check`, as sent by `--upload` (RFC 0005): which repository,
 * commit and pull request, whether it passed, every applicable standard's outcome, and at
 * most 500 findings with one-line redacted snippets. Never file contents or diffs.
 */
export const CheckRun = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("CheckRun"),
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
    }),
    pullRequest: CheckRunPullRequest.optional().describe(
      "Present when the run was for a pull request.",
    ),
    mode: z.enum(["all", "changes"]),
    base: z.string().min(1).max(255).optional().describe("The ref compared against."),
    files: Count.describe("Files checked."),
    changedFiles: Count,
    passed: z.boolean(),
    failOn: z.enum(["blocker", "warning", "none"]),
    summary: z.strictObject({
      standards: Count,
      passed: Count,
      failed: Count,
      warned: Count,
      notEvaluable: Count,
      guidance: Count,
      skipped: Count,
      violations: Count,
      concerns: Count,
      suppressed: Count,
      legacy: Count,
      blocking: Count,
    }),
    outcomes: z.array(CheckRunOutcome).max(2000),
    findings: z.array(CheckRunFinding).max(500),
    omittedFindings: Count.describe("Findings beyond the 500 sent."),
  })
  .describe("A check run, produced by `groundrule check` and uploaded with --upload.");
export type CheckRunInput = z.input<typeof CheckRun>;
export type CheckRun = z.infer<typeof CheckRun>;
