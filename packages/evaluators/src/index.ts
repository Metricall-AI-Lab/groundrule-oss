import type { Evaluator } from "@groundrule/core";
import { changeSetEvaluator } from "./change-set.js";
import { dependenciesEvaluator } from "./dependencies.js";
import { filesEvaluator } from "./files.js";
import { importsEvaluator } from "./imports.js";
import { llmEvaluator } from "./llm.js";
import { regexEvaluator } from "./regex.js";
import { semgrepEvaluator } from "./semgrep.js";

export {
  type ImportRef,
  scanGoImports,
  scanJavaImports,
  scanJsImports,
  scanPyImports,
} from "./imports.js";
export { type Dependency, type Ecosystem, manifestEcosystem, parseManifest } from "./manifests.js";
export { semgrepRuntime } from "./semgrep.js";
export {
  changeSetEvaluator,
  dependenciesEvaluator,
  filesEvaluator,
  importsEvaluator,
  llmEvaluator,
  regexEvaluator,
  semgrepEvaluator,
};

/** Every evaluator that ships with Groundrule. */
export const builtinEvaluators: readonly Evaluator<unknown>[] = [
  filesEvaluator,
  regexEvaluator,
  dependenciesEvaluator,
  importsEvaluator,
  changeSetEvaluator,
  semgrepEvaluator,
  llmEvaluator,
] as readonly Evaluator<unknown>[];
