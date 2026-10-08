import { z } from "zod";

/** Version of the Groundrule document format. Every document declares it. */
export const API_VERSION = "groundrule.dev/v1alpha1";

export const ApiVersion = z
  .literal(API_VERSION)
  .describe(`Groundrule document format version. Must be "${API_VERSION}".`);

/**
 * Standard identifier: an uppercase prefix, optional uppercase segments, and a number.
 * Examples: AUTH-017, DATA-021, AI-003, CLAIMS-API-001.
 */
export const StandardId = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]+$/,
    "Standard IDs look like AUTH-017: an uppercase prefix, a dash, and a number",
  )
  .describe("Unique, stable standard identifier, e.g. AUTH-017.");
export type StandardId = z.infer<typeof StandardId>;

/** Lowercase kebab-case identifier used for packs and exceptions. */
export const Slug = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, digits, and dashes, e.g. security-baseline",
  );

/** How much a violation matters, from least to most severe. */
export const SEVERITIES = ["info", "advisory", "warning", "blocker"] as const;
export const Severity = z
  .enum(SEVERITIES)
  .describe(
    "info: context only. advisory: non-blocking recommendation. warning: visible, needs acknowledgment. blocker: fails the check.",
  );
export type Severity = z.infer<typeof Severity>;

/** How sure an evaluator is about a finding, from least to most certain. */
export const CONFIDENCES = ["low", "medium", "high", "certain"] as const;
export const Confidence = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof Confidence>;

/** Compare two severities. Negative when a < b, zero when equal, positive when a > b. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b);
}

/** Compare two confidences. Negative when a < b, zero when equal, positive when a > b. */
export function compareConfidence(a: Confidence, b: Confidence): number {
  return CONFIDENCES.indexOf(a) - CONFIDENCES.indexOf(b);
}

/**
 * How far a standard is rolled out in an organization, from least to most strict.
 * observe: checks run silently and results are only recorded.
 * teach: the standard is delivered to coding agents; checks still run silently.
 * advise: findings are shown, but never fail a check.
 * enforce: findings count at the standard's severity; blockers fail the check.
 */
export const ROLLOUT_STAGES = ["observe", "teach", "advise", "enforce"] as const;
export const RolloutStage = z
  .enum(ROLLOUT_STAGES)
  .describe(
    "observe: checked silently. teach: delivered to coding agents. advise: findings shown, never failing. enforce: findings count at the standard's severity.",
  );
export type RolloutStage = z.infer<typeof RolloutStage>;

/** Compare two rollout stages. Negative when a < b, zero when equal, positive when a > b. */
export function compareRolloutStage(a: RolloutStage, b: RolloutStage): number {
  return ROLLOUT_STAGES.indexOf(a) - ROLLOUT_STAGES.indexOf(b);
}

/** Expected false-positive rate of a standard's checks on typical repositories. */
export const NOISE_LEVELS = ["low", "medium", "high"] as const;
export const NoiseLevel = z
  .enum(NOISE_LEVELS)
  .describe(
    "low: findings are almost always real. medium: occasional false positives. high: expect to tune scope or exclusions.",
  );
export type NoiseLevel = z.infer<typeof NoiseLevel>;

/** A glob pattern matched against repository-relative POSIX paths. */
export const Glob = z.string().min(1).describe("Glob pattern, e.g. src/main/**/*.java");

/** Calendar date in YYYY-MM-DD form. */
export const IsoDate = z.iso.date().describe("Calendar date, YYYY-MM-DD.");
