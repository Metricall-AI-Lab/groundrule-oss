// `layout`: where files live and what they are called (ADR 0012). Applies to every file in
// `from` and checks, per file, its name (`name` glob or `namePattern` regex), its place
// (`place` globs it must be under) and its companions (`companion` patterns, one of which
// must match a repository file, with {dir}, {base}, {name} and {ext} filled in). File names
// only: nothing is read, and every finding is certain.
import { defineEvaluator, type EvaluatorFinding } from "@groundrule/core";
import picomatch from "picomatch";
import { z } from "zod";
import { Globs } from "./util.js";

const Options = z
  .strictObject({
    /** Files the rule applies to. Default: every file in the standard's scope. */
    from: Globs.optional(),
    /** Files in `from` the rule skips, e.g. the test files of a companion rule. */
    exclude: Globs.optional(),
    /** A glob the file's base name must match, e.g. "*.controller.ts". */
    name: z.string().min(1).optional(),
    /** A regular expression the file's base name must match, e.g. "^[a-z0-9-]+\\.ts$". */
    namePattern: z.string().min(1).optional(),
    /** Directories the file must live under; outside every one is a finding. */
    place: Globs.optional(),
    /** Patterns for a file that must exist for it; {dir}, {base}, {name}, {ext} are filled in. */
    companion: Globs.optional(),
    message: z.string().min(1).optional(),
    remediation: z.string().min(1).optional(),
  })
  .refine((o) => o.name || o.namePattern || o.place || o.companion, {
    message: "Give at least one of `name`, `namePattern`, `place` or `companion`.",
  })
  .refine(
    (o) => {
      if (!o.namePattern) return true;
      try {
        new RegExp(o.namePattern);
        return true;
      } catch {
        return false;
      }
    },
    { message: "`namePattern` is not a valid regular expression.", path: ["namePattern"] },
  );
type LayoutOptions = z.infer<typeof Options>;

const parts = (file: string) => {
  const slash = file.lastIndexOf("/");
  const dir = slash >= 0 ? file.slice(0, slash) : "";
  const name = slash >= 0 ? file.slice(slash + 1) : file;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const base = dot > 0 ? name.slice(0, dot) : name;
  return { dir, name, base, ext };
};

/** `{dir}/{base}.test.ts` with the file's parts; a leading "/" from an empty dir is dropped. */
const fillCompanion = (pattern: string, p: ReturnType<typeof parts>) =>
  pattern
    .replace(/\{dir\}/g, p.dir)
    .replace(/\{base\}/g, p.base)
    .replace(/\{name\}/g, p.name)
    .replace(/\{ext\}/g, p.ext)
    .replace(/^\/+/, "");

export const layoutEvaluator = defineEvaluator({
  id: "layout",
  source: "deterministic",
  description:
    "Where files live and what they are called: a name pattern, the directories a kind of file may live under, and a companion file that must exist for it (a test beside each source file).",
  optionsSchema: Options as unknown as z.ZodType<LayoutOptions>,
  async evaluate({ options, context }) {
    const from = options.from ? picomatch(options.from, { dot: true }) : () => true;
    const skip = options.exclude ? picomatch(options.exclude, { dot: true }) : () => false;
    const nameGlob = options.name ? picomatch(options.name, { dot: true }) : null;
    const nameRe = options.namePattern ? new RegExp(options.namePattern) : null;
    const place = options.place ? picomatch(options.place, { dot: true }) : null;
    const all = new Set(context.files);
    const findings: EvaluatorFinding[] = [];
    for (const file of context.targetFiles) {
      if (!from(file) || skip(file)) continue;
      const p = parts(file);
      const problems: { message: string; evidence: string }[] = [];
      if (nameGlob && !nameGlob(p.name))
        problems.push({
          message: `${file} is not named like ${options.name}`,
          evidence: `${file}: the name "${p.name}" does not match ${options.name}`,
        });
      if (nameRe && !nameRe.test(p.name))
        problems.push({
          message: `${file} is not named as the pattern requires`,
          evidence: `${file}: the name "${p.name}" does not match /${options.namePattern}/`,
        });
      if (place && !place(file))
        problems.push({
          message: `${file} lives outside ${options.place?.join(", ")}`,
          evidence: `${file} is not under ${options.place?.join(", ")}`,
        });
      if (options.companion) {
        const expected = options.companion.map((c) => fillCompanion(c, p));
        const found = expected.some((e) =>
          e.includes("*")
            ? context.files.some((f) => picomatch.isMatch(f, e, { dot: true }))
            : all.has(e),
        );
        if (!found)
          problems.push({
            message: `${file} has no companion file (${expected.join(" or ")})`,
            evidence: `${file}: none of ${expected.join(", ")} exists`,
          });
      }
      for (const problem of problems)
        findings.push({
          status: "violation",
          confidence: "certain",
          message: options.message ?? problem.message,
          location: { file, startLine: 1 },
          evidence: [problem.evidence],
          ...(options.remediation ? { remediation: options.remediation } : {}),
          snippet: p.name,
        });
    }
    return findings;
  },
});
