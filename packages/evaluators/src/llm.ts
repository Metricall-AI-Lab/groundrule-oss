// `llm`: an AI review (RFC 0013). The question is answered by Groundrule's hosted checks, over
// the changed lines of the files the rule names, outside the sandbox and within the workspace's
// AI budget. Here, and in CI, the rule is reported as not run: a laptop never pays for tokens
// or sends code anywhere. The options are validated so a standard with a check is well formed.
import { defineEvaluator } from "@groundrule/core";
import { z } from "zod";

const Globs = z.array(z.string().min(1, "Patterns can't be empty")).min(1);

export const llmEvaluator = defineEvaluator({
  id: "llm",
  source: "ai",
  description:
    "AI review: a question about the change, answered on Groundrule's hosted checks. Advisory; never fails a change.",
  optionsSchema: z.strictObject({
    /** What a reviewer would ask about the change, as one question. */
    question: z.string().trim().min(20, "Ask a full question (at least 20 characters)").max(2_000),
    /** Files to review; the standard's scope otherwise. */
    include: Globs.optional(),
    exclude: Globs.optional(),
    /** Findings below this confidence are dropped: medium (default) or high. */
    minConfidence: z.enum(["medium", "high"]).optional(),
  }),
  supports() {
    return "AI checks run on Groundrule's hosted checks; not here. The rule's other checks still run.";
  },
  async evaluate() {
    return [];
  },
});
