import type { Scope } from "@groundrule/spec";
import picomatch from "picomatch";

/** What a scope is matched against. Unknown facts never exclude a standard. */
export interface ScopeTarget {
  /** Repository-relative POSIX path of a file. Omit to match at repository level. */
  path?: string;
  /** Repository name, e.g. claims-service. */
  repository?: string;
  /** Languages detected for the file or repository. */
  languages?: readonly string[];
  /** Frameworks detected for the repository. */
  frameworks?: readonly string[];
  /** Tags declared in the repository config. */
  tags?: readonly string[];
}

const GLOB_OPTIONS = { dot: true } as const;

/**
 * True if a standard with this scope applies to the target.
 * Every declared scope field must match; an omitted field never restricts.
 */
export function matchesScope(scope: Scope, target: ScopeTarget): boolean {
  if (scope.repositories?.length && target.repository !== undefined) {
    if (!picomatch.isMatch(target.repository, scope.repositories, GLOB_OPTIONS)) return false;
  }
  if (target.path !== undefined) {
    if (scope.paths?.length && !picomatch.isMatch(target.path, scope.paths, GLOB_OPTIONS))
      return false;
    if (scope.exclude?.length && picomatch.isMatch(target.path, scope.exclude, GLOB_OPTIONS))
      return false;
  }
  if (!intersects(scope.languages, target.languages)) return false;
  if (!intersects(scope.frameworks, target.frameworks)) return false;
  if (!intersects(scope.tags, target.tags)) return false;
  return true;
}

/** A required list matches if the target is unknown or shares at least one value. */
function intersects(
  required: readonly string[] | undefined,
  actual: readonly string[] | undefined,
): boolean {
  if (!required?.length || actual === undefined) return true;
  const normalized = new Set(actual.map((v) => v.toLowerCase()));
  return required.some((v) => normalized.has(v.toLowerCase()));
}
