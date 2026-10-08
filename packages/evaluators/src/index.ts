import type { Evaluator } from "@groundrule/core";
import { changeSetEvaluator } from "./change-set.js";
import { dependenciesEvaluator } from "./dependencies.js";
import { filesEvaluator } from "./files.js";
import { llmEvaluator } from "./llm.js";
import { regexEvaluator } from "./regex.js";
import { semgrepEvaluator } from "./semgrep.js";

export { type Dependency, type Ecosystem, manifestEcosystem, parseManifest } from "./manifests.js";
export { semgrepRuntime } from "./semgrep.js";
export {
  changeSetEvaluator,
  dependenciesEvaluator,
  filesEvaluator,
  llmEvaluator,
  regexEvaluator,
  semgrepEvaluator,
};

/** Every evaluator that ships with Groundrule. */
export const builtinEvaluators: readonly Evaluator<unknown>[] = [
  filesEvaluator,
  regexEvaluator,
  dependenciesEvaluator,
  changeSetEvaluator,
  semgrepEvaluator,
  llmEvaluator,
] as readonly Evaluator<unknown>[];
