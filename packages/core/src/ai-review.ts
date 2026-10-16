// AI review requests (RFC 0013): for every rule with an `llm` check and every changed file it
// names, the changed lines with a little context, secrets redacted. Collected after a run so
// a hosted check can ask the model outside the sandbox; nothing here calls anything.
import { type AiReviewRequest, type AiReviewRequests, API_VERSION } from "@groundrule/spec";
import picomatch from "picomatch";
import type { ChangedFile } from "./evaluator.js";
import { languageOf } from "./languages.js";
import { appliesToRepository, type RepositoryInfo } from "./repository.js";
import { redactSecrets } from "./scan.js";
import { matchesScope } from "./scope.js";
import type { LoadedStandard } from "./workspace.js";

/** Lines of context on each side of a changed range. */
const CONTEXT = 3;
/** Per run: files, lines per file, bytes in all. Past them, the rest is reported as skipped. */
export const AI_REVIEW_LIMITS = { files: 40, linesPerFile: 400, bytes: 200_000 } as const;
const GLOB = { dot: true };

export interface AiReviewInput {
  standards: readonly LoadedStandard[];
  repo: RepositoryInfo;
  /** The run's changed files; without them (mode "all") nothing is collected. */
  changes: readonly ChangedFile[] | undefined;
  readFile: (path: string) => Promise<string>;
  cliVersion: string;
  now?: Date;
}

interface LlmCheck {
  question: string;
  include?: string[];
  exclude?: string[];
  minConfidence?: "medium" | "high";
}

/** The `llm` checks of a rule that runs checks at its stage, as typed options. */
function llmChecks(l: LoadedStandard): LlmCheck[] {
  if (l.disabled || l.standard.metadata.status !== "active") return [];
  if (l.stage && l.stage !== "advise" && l.stage !== "enforce") return [];
  return l.standard.spec.checks.flatMap((c) => {
    if (c.evaluator !== "llm") return [];
    const o = c as Record<string, unknown>;
    if (typeof o.question !== "string" || !o.question.trim()) return [];
    const globs = (v: unknown) =>
      Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : undefined;
    const include = globs(o.include);
    const exclude = globs(o.exclude);
    const check: LlmCheck = { question: o.question.trim() };
    if (include?.length) check.include = include;
    if (exclude?.length) check.exclude = exclude;
    if (o.minConfidence === "high") check.minConfidence = "high";
    return [check];
  });
}

/** Changed ranges widened by context, merged, and clipped to the file. */
function hunksOf(
  lines: readonly string[],
  ranges: readonly { start: number; end: number }[],
): { startLine: number; lines: string[] }[] {
  const sorted = [...ranges]
    .map((r) => ({
      start: Math.max(1, r.start - CONTEXT),
      end: Math.min(lines.length, r.end + CONTEXT),
    }))
    .filter((r) => r.start <= r.end)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = merged.at(-1);
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged.map((r) => ({
    startLine: r.start,
    lines: lines.slice(r.start - 1, r.end).map((line) => redactSecrets(line).slice(0, 2_000)),
  }));
}

export async function collectAiReviewRequests(input: AiReviewInput): Promise<AiReviewRequests> {
  const now = input.now ?? new Date();
  const out: AiReviewRequests = {
    apiVersion: API_VERSION,
    kind: "AiReviewRequests",
    metadata: { generatedAt: now.toISOString(), cliVersion: input.cliVersion },
    requests: [],
    skipped: { files: 0, standards: [] },
  };
  if (!input.changes) return out;
  const rules = input.standards
    .filter((l) => appliesToRepository(l.standard, input.repo))
    .map((l) => ({ l, checks: llmChecks(l) }))
    .filter((r) => r.checks.length);
  if (!rules.length) return out;

  const changed = input.changes.filter((c) => c.status !== "deleted" && c.changedLines.length);
  const contents = new Map<string, string[] | null>();
  const read = async (path: string) => {
    if (!contents.has(path)) {
      try {
        const text = await input.readFile(path);
        // A trailing newline ends the last line; it doesn't start an empty one.
        const lines = text.split("\n");
        if (lines.length > 1 && lines.at(-1) === "") lines.pop();
        contents.set(path, text.includes("\0") ? null : lines);
      } catch {
        contents.set(path, null);
      }
    }
    return contents.get(path) ?? null;
  };

  let files = 0;
  let bytes = 0;
  const skippedStandards = new Set<string>();
  const skippedFiles = new Set<string>();
  for (const file of changed) {
    const language = languageOf(file.path);
    const target = {
      path: file.path,
      repository: input.repo.name,
      languages: language ? [language] : input.repo.languages,
      frameworks: input.repo.frameworks,
      tags: input.repo.tags,
    };
    const wanting = rules.flatMap(({ l, checks }) => {
      if (!matchesScope(l.standard.spec.scope, target)) return [];
      return checks
        .filter(
          (c) =>
            (!c.include || picomatch.isMatch(file.path, c.include, GLOB)) &&
            !(c.exclude && picomatch.isMatch(file.path, c.exclude, GLOB)),
        )
        .map((c) => ({ l, c }));
    });
    if (!wanting.length) continue;
    const lines = await read(file.path);
    if (!lines) continue;
    const hunks = hunksOf(lines, file.changedLines);
    const lineCount = hunks.reduce((n, h) => n + h.lines.length, 0);
    const size = hunks.reduce((n, h) => n + h.lines.join("\n").length, 0);
    const over =
      files >= AI_REVIEW_LIMITS.files ||
      lineCount > AI_REVIEW_LIMITS.linesPerFile ||
      bytes + size > AI_REVIEW_LIMITS.bytes;
    if (over || !hunks.length) {
      if (hunks.length) {
        skippedFiles.add(file.path);
        for (const { l } of wanting) skippedStandards.add(l.standard.metadata.id);
      }
      continue;
    }
    files++;
    bytes += size;
    for (const { l, c } of wanting) {
      const request: AiReviewRequest = {
        standardId: l.standard.metadata.id,
        standardVersion: l.standard.metadata.version ?? 1,
        title: l.standard.metadata.title,
        requirement: l.standard.spec.requirement.slice(0, 4_000),
        severity: l.standard.spec.severity,
        question: c.question.slice(0, 2_000),
        minConfidence: c.minConfidence ?? "medium",
        file: file.path,
        ...(language ? { language } : {}),
        hunks,
      };
      out.requests.push(request);
    }
  }
  out.skipped = { files: skippedFiles.size, standards: [...skippedStandards].sort() };
  out.requests = out.requests.slice(0, 500);
  return out;
}
