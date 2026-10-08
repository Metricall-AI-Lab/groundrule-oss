import type { Check, Finding, FindingSource, Standard } from "@groundrule/spec";
import type { z } from "zod";

/** A line range in the new version of a file, 1-based and inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

export interface ChangedFile {
  /** Repository-relative POSIX path (new path for renames). */
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
  /** Lines added or modified in the new version. Empty for deletions. */
  changedLines: readonly LineRange[];
}

/** Everything an evaluator may know about the code under evaluation. */
export interface EvalContext {
  /** Absolute path of the repository root. */
  root: string;
  repository?: string;
  languages: readonly string[];
  frameworks: readonly string[];
  tags: readonly string[];
  /** Every repository file in the standard's scope, whatever the run mode. */
  files: readonly string[];
  /**
   * Files whose content should be scanned: the changed files in scope when
   * evaluating a change, otherwise the same as `files`. Content evaluators
   * (regex, dependencies, semgrep) scan these; repository-level evaluators
   * (required files) use `files`.
   */
  targetFiles: readonly string[];
  /** Present when evaluating a change (local diff or pull request). */
  changes?: readonly ChangedFile[];
  /** Read a repository file as UTF-8. Paths are repository-relative. */
  readFile(path: string): Promise<string>;
  /** Abort long-running work (timeouts, Ctrl-C). */
  signal: AbortSignal;
  /** Structured logging; never write to stdout directly. */
  log: (level: "debug" | "info" | "warn", message: string) => void;
}

/**
 * The fields an evaluator reports. The runner fills in standard ID, version,
 * evaluator ID, source, severity, new-vs-legacy, exceptions, and fingerprint defaults.
 */
export type EvaluatorFinding = Pick<Finding, "status" | "confidence" | "message"> &
  Partial<Pick<Finding, "location" | "evidence" | "remediation" | "fingerprint">> & {
    /** Code the finding is about; used for a stable fingerprint when none is given. */
    snippet?: string;
  };

export interface EvaluateInput<Options> {
  standard: Standard;
  /** The check exactly as written in the standard, including `evaluator`. */
  check: Check;
  /** Check options after validation by `optionsSchema`. */
  options: Options;
  /** Absolute directory of the file that defines the standard; check paths resolve against it. */
  standardDir: string;
  context: EvalContext;
}

/**
 * The plugin contract. Every check in a standard names an evaluator by `id`.
 * Built-in evaluators and third-party plugins implement this same interface.
 */
export interface Evaluator<Options = unknown> {
  /** Stable lowercase ID referenced from standards, e.g. "dependencies". */
  readonly id: string;
  /** Shown with every finding so users know how much to trust it. */
  readonly source: FindingSource;
  readonly description: string;
  /** Validates the check's options (every key except `evaluator` and `minConfidence`). */
  readonly optionsSchema: z.ZodType<Options>;
  /**
   * Cheap pre-check: can this evaluator run here at all (tooling installed, language supported)?
   * Return true if it can, or a short, actionable reason why not, e.g. "Install semgrep: brew install semgrep".
   */
  supports?(context: EvalContext): true | string | Promise<true | string>;
  evaluate(input: EvaluateInput<Options>): Promise<EvaluatorFinding[]>;
}

/** Helper that gives evaluator authors full type inference on options. */
export function defineEvaluator<Options>(evaluator: Evaluator<Options>): Evaluator<Options> {
  return evaluator;
}
