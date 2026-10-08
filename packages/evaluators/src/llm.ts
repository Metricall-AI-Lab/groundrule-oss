import { defineEvaluator } from "@groundrule/core";
import { z } from "zod";

/**
 * Placeholder until AI checks ship (Milestone 2). Accepts the options so standards
 * that use it validate today, and reports itself as not evaluable.
 */
export const llmEvaluator = defineEvaluator({
  id: "llm",
  source: "ai",
  description: "AI review against the standard (coming in Groundrule 0.2).",
  optionsSchema: z.looseObject({
    question: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
  }),
  supports() {
    return "AI checks arrive in Groundrule 0.2 (bring your own API key).";
  },
  async evaluate() {
    return [];
  },
});
