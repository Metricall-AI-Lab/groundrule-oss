// Just-in-time rules (ADR 0010): which rules name the files an agent is about to change. Only
// rules with a path scope are listed; the rest are in the agent file already, and the answer
// says how many there are.
import {
  enforcementOf,
  type LoadedStandard,
  languageOf,
  matchesScope,
  type RepositoryInfo,
} from "@groundrule/core";
import { compareSeverity, type Severity } from "@groundrule/spec";

/** Rules listed at most; beyond that the answer says how many more. */
export const MAX_RULES = 25;
/** Characters of text at most, so an injection never crowds out the task. */
const MAX_TEXT = 4_000;

export interface RuleForFiles {
  id: string;
  title: string;
  severity: Severity;
  stage?: string;
  requirement: string;
  fix?: string;
  checked: boolean;
  /** The given files the rule applies to. */
  files: string[];
}

export interface RulesForResult {
  rules: RuleForFiles[];
  /** Rules in effect that name no paths: in the agent file already. */
  unscoped: number;
  /** Matching rules beyond MAX_RULES. */
  more: number;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const toPosix = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

const STAGE_NOTE: Record<string, string> = {
  advise: "advise: findings warn, never fail",
  enforce: "enforce",
  teach: "teach: guidance only",
};

export function rulesFor(
  standards: readonly LoadedStandard[],
  repo: RepositoryInfo,
  files: readonly string[],
): RulesForResult {
  const paths = [...new Set(files.map(toPosix).filter(Boolean))];
  let unscoped = 0;
  const rules: RuleForFiles[] = [];
  for (const l of standards) {
    if (l.disabled || l.standard.metadata.status !== "active") continue;
    const { scope } = l.standard.spec;
    const repoLevel = matchesScope(
      { ...scope, paths: undefined, exclude: undefined },
      {
        repository: repo.name,
        languages: repo.languages,
        frameworks: repo.frameworks,
        tags: repo.tags,
      },
    );
    if (!repoLevel) continue;
    if (!scope.paths?.length && !scope.exclude?.length) {
      unscoped++;
      continue;
    }
    const matched = paths.filter((path) => {
      const language = languageOf(path);
      return matchesScope(scope, {
        path,
        repository: repo.name,
        languages: language ? [language] : repo.languages,
        frameworks: repo.frameworks,
        tags: repo.tags,
      });
    });
    if (!matched.length) continue;
    const fix = l.standard.spec.remediation ?? l.standard.spec.agent?.summary;
    rules.push({
      id: l.standard.metadata.id,
      title: l.standard.metadata.title,
      severity: l.standard.spec.severity,
      ...(l.stage ? { stage: l.stage } : {}),
      requirement: oneLine(l.standard.spec.agent?.summary ?? l.standard.spec.requirement),
      ...(fix && fix !== l.standard.spec.agent?.summary ? { fix: oneLine(fix) } : {}),
      checked:
        enforcementOf(l.standard.spec.checks.map((c) => c.evaluator)) === "checked" &&
        (!l.stage || l.stage === "advise" || l.stage === "enforce"),
      files: matched,
    });
  }
  rules.sort((a, b) => compareSeverity(b.severity, a.severity) || a.id.localeCompare(b.id));
  return {
    rules: rules.slice(0, MAX_RULES),
    unscoped,
    more: Math.max(0, rules.length - MAX_RULES),
  };
}

/** The answer an agent reads: one line per rule, the files it names, and what else exists. */
export function rulesForText(result: RulesForResult, files: readonly string[]): string {
  const where = files.length === 1 ? (files[0] as string) : `${files.length} files`;
  if (!result.rules.length)
    return `No rule names ${where} specifically. ${result.unscoped} repository-wide ${result.unscoped === 1 ? "rule applies" : "rules apply"} everywhere; they are in the agent file (AGENTS.md or CLAUDE.md).`;
  const lines = [
    `Groundrule rules for ${where} (follow these; ${result.unscoped} repository-wide ${result.unscoped === 1 ? "rule is" : "rules are"} in the agent file):`,
  ];
  let size = lines[0]?.length ?? 0;
  let listed = 0;
  for (const r of result.rules) {
    const line = `- ${r.id} (${r.severity}${r.stage ? ` · ${STAGE_NOTE[r.stage] ?? r.stage}` : ""}${r.checked ? " · checked automatically" : ""}) ${r.title}: ${r.requirement}${r.fix ? ` Fix: ${r.fix}` : ""}${files.length > 1 ? ` [${r.files.join(", ")}]` : ""}`;
    if (size + line.length > MAX_TEXT) break;
    lines.push(line);
    size += line.length + 1;
    listed++;
  }
  const left = result.rules.length - listed + result.more;
  if (left > 0) lines.push(`…and ${left} more; call list_standards for the full list.`);
  return lines.join("\n");
}
