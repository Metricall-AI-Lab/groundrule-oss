/**
 * How a standard is enforced, in one word, so every surface says the same thing:
 * - `checked`: at least one deterministic or static-analysis check, so it can fail a change;
 * - `ai-review`: only AI checks, which are advisory and never fail a change on their own;
 * - `guidance`: no checks; coding agents and reviewers are told, and nothing checks it.
 */
export type Enforcement = "checked" | "ai-review" | "guidance";

/** Evaluators whose findings are AI judgments rather than facts about the code. */
export const AI_EVALUATORS: ReadonlySet<string> = new Set(["llm"]);

/** The enforcement of a standard from the evaluators of its checks. */
export function enforcementOf(evaluators: readonly string[]): Enforcement {
  if (evaluators.length === 0) return "guidance";
  return evaluators.some((e) => !AI_EVALUATORS.has(e)) ? "checked" : "ai-review";
}

/** A rule that should be able to fail a change (blocker or warning) but can't. */
export function cannotFail(severity: string, evaluators: readonly string[]): boolean {
  return (
    (severity === "blocker" || severity === "warning") && enforcementOf(evaluators) !== "checked"
  );
}

export const ENFORCEMENT_LABEL: Record<Enforcement, string> = {
  checked: "checked",
  "ai-review": "AI review (advisory)",
  guidance: "agent guidance",
};
