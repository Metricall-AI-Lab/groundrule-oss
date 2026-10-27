import type { Evaluator } from "@groundrule/core";
import { changeSetEvaluator } from "./change-set.js";
import { dependenciesEvaluator } from "./dependencies.js";
import { filesEvaluator } from "./files.js";
import { importsEvaluator } from "./imports.js";
import { layoutEvaluator } from "./layout.js";
import { llmEvaluator } from "./llm.js";
import { regexEvaluator } from "./regex.js";
import { semgrepEvaluator } from "./semgrep.js";

export {
  compileImportRule,
  type ImportPreview,
  type ImportRef,
  previewImports,
  type ResolvedEdge,
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
  layoutEvaluator,
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
  layoutEvaluator,
  changeSetEvaluator,
  semgrepEvaluator,
  llmEvaluator,
] as readonly Evaluator<unknown>[];
