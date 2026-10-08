import type { LoadedStandard, RunResult } from "@groundrule/core";
import type { Location } from "@groundrule/spec";

/** What every reporter receives. */
export interface ReportInput {
  result: RunResult;
  standards: readonly LoadedStandard[];
  /** Groundrule version, shown in machine-readable output. */
  version: string;
}

export function standardsById(input: ReportInput) {
  return new Map(input.standards.map((s) => [s.standard.metadata.id, s]));
}

export const SOURCE_LABEL = {
  deterministic: "deterministic",
  "static-analysis": "static analysis",
  ai: "AI",
  external: "external",
} as const;

export function locationLabel(location: Location | undefined): string {
  if (!location) return "repository";
  return location.endLine && location.endLine !== location.startLine
    ? `${location.file}:${location.startLine}-${location.endLine}`
    : `${location.file}:${location.startLine}`;
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}
