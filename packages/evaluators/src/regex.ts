import { defineEvaluator, type EvaluatorFinding } from "@groundrule/core";
import { z } from "zod";
import { Globs, globFilter, lineIndex, readText, truncate } from "./util.js";

const Options = z
  .strictObject({
    pattern: z.string().min(1, "Enter a regular expression"),
    /** Regex flags. `g` and `m` are always applied. Allowed: i, s, u. */
    flags: z
      .string()
      .regex(/^[isu]*$/, "Allowed flags: i, s, u")
      .default(""),
    /** forbid: report every match. require: report files that do not match. */
    mode: z.enum(["forbid", "require"]).default("forbid"),
    message: z.string().min(1).optional(),
    include: Globs.optional(),
    exclude: Globs.optional(),
    maxMatchesPerFile: z.number().int().positive().max(1000).default(20),
  })
  .refine(
    (o) => {
      try {
        new RegExp(o.pattern, o.flags);
        return true;
      } catch {
        return false;
      }
    },
    { message: "pattern is not a valid regular expression", path: ["pattern"] },
  );

export const regexEvaluator = defineEvaluator({
  id: "regex",
  source: "deterministic",
  description: "Forbid or require a regular expression in file contents.",
  optionsSchema: Options,
  async evaluate({ options, context }) {
    const findings: EvaluatorFinding[] = [];
    const inScope = globFilter(options.include, options.exclude);
    const label = `/${options.pattern}/${options.flags}`;

    for (const file of context.targetFiles.filter(inScope)) {
      if (context.signal.aborted) break;
      const text = await readText(context.readFile, file);
      if (text === undefined) continue;
      const regex = new RegExp(options.pattern, `gm${options.flags}`);

      if (options.mode === "require") {
        if (!regex.test(text)) {
          findings.push({
            status: "violation",
            confidence: "certain",
            message: options.message ?? `Required pattern ${label} not found`,
            location: { file, startLine: 1 },
            evidence: [`${file} does not contain ${label}`],
            snippet: `require:${file}`,
          });
        }
        continue;
      }

      const lines = lineIndex(text);
      // Fingerprint by line content plus its occurrence number, so unrelated edits don't change it.
      const occurrences = new Map<string, number>();
      let count = 0;
      for (const match of text.matchAll(regex)) {
        if (match[0].length === 0) continue;
        // Locate at the first non-whitespace character, so patterns like ^\s* that
        // swallow a preceding newline still point at the right line.
        const leading = match[0].length - match[0].trimStart().length;
        const startLine = lines.lineAt(match.index + Math.min(leading, match[0].length - 1));
        const endLine = lines.lineAt(match.index + match[0].length - 1);
        const source = lines.line(startLine);
        const key = source.trim();
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        findings.push({
          status: "violation",
          confidence: "certain",
          message: options.message ?? `Matches forbidden pattern ${label}`,
          location: { file, startLine, ...(endLine !== startLine ? { endLine } : {}) },
          evidence: [`${startLine}: ${truncate(source)}`],
          snippet: `${key}#${occurrence}`,
        });
        if (++count >= options.maxMatchesPerFile) break;
      }
    }
    return findings;
  },
});
