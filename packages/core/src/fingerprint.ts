import { createHash } from "node:crypto";

export interface FingerprintInput {
  standardId: string;
  evaluator: string;
  file?: string;
  /**
   * The code the finding is about. Whitespace is normalized so that reformatting
   * or moving code does not change the fingerprint. Prefer this over line numbers,
   * which shift with unrelated edits.
   */
  snippet?: string;
  /** Extra discriminator when one snippet can yield several findings. */
  key?: string;
}

/** Stable identity of a finding across runs, used for baselines, dedupe, and feedback. */
export function computeFingerprint(input: FingerprintInput): string {
  const snippet = input.snippet?.replace(/\s+/g, " ").trim() ?? "";
  const material = [
    input.standardId,
    input.evaluator,
    input.file ?? "",
    snippet,
    input.key ?? "",
  ].join("\u0000");
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}
