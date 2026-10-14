import { z } from "zod";
import { ApiVersion, IsoDate, RolloutStage, Severity, StandardId } from "./common.js";
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

/** `sha256:` and 64 lowercase hex characters (RFC 0007). */
export const Digest = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "A digest looks like sha256: followed by 64 hex characters")
  .describe("sha256: followed by the SHA-256 in lowercase hex.");

/** Whether a standard can fail a change (RFC 0007; enforcementOf in @groundrule/core). */
export const EnforcementLabel = z
  .enum(["checked", "ai-review", "guidance"])
  .describe(
    "checked: a deterministic or static-analysis check can fail a change. ai-review: AI checks only, advisory. guidance: no check.",
  );
export type EnforcementLabel = z.infer<typeof EnforcementLabel>;

export const CheckRunOutcome = z.strictObject({
  id: StandardId,
  title: z.string().min(1).max(200),
  severity: Severity,
  status: CheckOutcome,
  violations: Count,
  concerns: Count,
  version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("The standard's metadata.version when the run used it (RFC 0007)."),
  digest: Digest.optional().describe(
    "SHA-256 of the standard as applied, after customizations, as canonical JSON (RFC 0007).",
  ),
  stage: RolloutStage.optional().describe(
    "The organization's rollout stage for this rule. Absent for rules without a stage.",
  ),
  enforcement: EnforcementLabel.optional(),
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
/** Every rule in effect, as one digest (RFC 0007). */
export const CheckRunRulebook = z
  .strictObject({
    digest: Digest.describe(
      "SHA-256 of one line per rule in effect, '<id> <digest> <stage or -> <severity>', sorted by ID.",
    ),
    standards: Count.describe("Rules in effect: active, not turned off, at any stage but Observe."),
    source: z
      .enum(["platform", "local"])
      .describe("Rules from a Groundrule workspace, or local files only."),
    platform: z
      .strictObject({
        org: z.string().min(1).max(100),
        generatedAt: z.iso.datetime({ offset: true }),
      })
      .optional()
      .describe("The workspace and when its rulebook was generated, when source is platform."),
  })
  .describe("Which rules were in effect for the run, verifiably.");
export type CheckRunRulebook = z.infer<typeof CheckRunRulebook>;

/** An exception that suppressed findings in the run (RFC 0007). */
export const CheckRunException = z.strictObject({
  id: z.string().regex(/^EX-[0-9]+$/),
  standard: StandardId,
  expires: IsoDate,
  approvedBy: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("As written in .groundrule/exceptions.yaml."),
  suppressed: Count.describe("Findings it suppressed in this run."),
});
export type CheckRunException = z.infer<typeof CheckRunException>;

/** Coding agents the change's commits declare (RFC 0007). Counts only. */
export const CheckRunAuthorship = z
  .strictObject({
    commits: Count.describe("Commits in the change."),
    agents: z
      .array(z.strictObject({ name: z.string().min(1).max(60), commits: Count }))
      .max(20)
      .describe("Each coding agent declared by the commits, most commits first."),
    method: z
      .literal("commit-metadata")
      .describe(
        "Detected from commit trailers and bot authors, never from code. A declaration, not proof.",
      ),
  })
  .describe("Who or what wrote the change, as declared in its commits.");
export type CheckRunAuthorship = z.infer<typeof CheckRunAuthorship>;

/** A key-based signature (RFC 0008). */
export const CheckRunKeySignature = z.strictObject({
  algorithm: z.literal("ed25519"),
  keyId: Digest.describe("sha256: of the public key's raw 32 bytes."),
  value: z
    .string()
    .regex(/^[A-Za-z0-9+/]{86}==$/, "An Ed25519 signature is 64 bytes, base64")
    .describe("The Ed25519 signature of the signing payload, base64."),
});

/** A keyless signature by the CI job's identity through Sigstore (RFC 0009). */
export const CheckRunSigstoreSignature = z.strictObject({
  algorithm: z.literal("sigstore"),
  bundle: z
    .object({ mediaType: z.string().regex(/^application\/vnd\.dev\.sigstore\.bundle/) })
    .loose()
    .describe("The Sigstore bundle: certificate, signature over the payload, and the log entry."),
  identity: z
    .strictObject({
      issuer: z.url().max(200).describe("The OIDC issuer, e.g. GitHub Actions."),
      subject: z
        .string()
        .min(1)
        .max(500)
        .describe(
          "The signer, e.g. https://github.com/acme/payments/.github/workflows/ci.yml@refs/heads/main.",
        ),
    })
    .describe(
      "The certificate's identity, copied out so readers needn't parse it; verifiers re-derive it.",
    ),
});

export type CheckRunKeySignature = z.infer<typeof CheckRunKeySignature>;
export type CheckRunSigstoreSignature = z.infer<typeof CheckRunSigstoreSignature>;

/** Who signed the run, and the signature (RFC 0008, RFC 0009). The payload is the canonical JSON of the run without `signature` and without snippets. */
export const CheckRunSignature = z
  .discriminatedUnion("algorithm", [CheckRunKeySignature, CheckRunSigstoreSignature])
  .describe("Proves the run is what its signer produced; verifiable offline.");
export type CheckRunSignature = z.infer<typeof CheckRunSignature>;

export const CheckRun = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("CheckRun"),
    metadata: z.strictObject({
      generatedAt: z.iso.datetime({ offset: true }),
      cliVersion: z.string().min(1).max(40),
      durationMs: Count,
      snippets: z.boolean().describe("Whether code snippets were included."),
      authorship: z
        .boolean()
        .optional()
        .describe("false when --no-authorship left the authorship record out (RFC 0007)."),
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
    rulebook: CheckRunRulebook.optional(),
    exceptions: z
      .array(CheckRunException)
      .max(200)
      .optional()
      .describe("Exceptions that suppressed at least one finding in this run."),
    authorship: CheckRunAuthorship.optional(),
    signature: CheckRunSignature.optional(),
  })
  .describe("A check run, produced by `groundrule check` and uploaded with --upload.");
export type CheckRunInput = z.input<typeof CheckRun>;
export type CheckRun = z.infer<typeof CheckRun>;
