// `imports`: deterministic architecture rules about who may import what (ADR 0009). Three
// shapes, all over the import statements of the files under check:
// - layers:   files matching `from` must not import repository code matching `forbid`
//             (with `allow` exceptions);
// - gates:    only files matching `only` may import a `package`;
// - placeholders: `{name}` in `from` captures a path segment and substitutes it into
//             `forbid` and `allow`, so "features don't import each other" is one rule.
// Imports are resolved to repository paths (relative paths, tsconfig/jsconfig `paths`, npm
// workspaces, Python packages, Java and Kotlin source roots, Go modules; ADR 0011); whatever
// can't be resolved to the repository counts as a package and never as a layer violation, so
// precision stays high.

import {
  defineEvaluator,
  type EvaluatorFinding,
  type ImportAliases,
  isImportSource,
  readImportAliases,
  resolveImport,
  scanImports,
} from "@groundrule/core";
import picomatch from "picomatch";
import { z } from "zod";
import { lineIndex, readText, truncate } from "./util.js";

const Globs = z.array(z.string().min(1, "Patterns can't be empty")).min(1);

const Options = z
  .strictObject({
    /** Files the rule applies to. Default: every file in the standard's scope. */
    from: Globs.optional(),
    /** Repository paths the `from` files must not import. */
    forbid: Globs.optional(),
    /** Exceptions within `forbid`, e.g. a module's public entry. */
    allow: Globs.optional(),
    /** Package names or globs, e.g. "stripe", "@prisma/*", "sqlalchemy". */
    package: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    /** The only files allowed to import `package`. */
    only: Globs.optional(),
    message: z.string().min(1).optional(),
    remediation: z.string().min(1).optional(),
  })
  .refine((o) => Boolean(o.forbid) !== Boolean(o.package), {
    message: "Give either `forbid` (a layer rule) or `package` with `only` (a package gate).",
  })
  .refine((o) => !o.package || o.only, { message: "`package` needs `only`: who may import it." });
type ImportOptions = z.infer<typeof Options>;

export type { ImportRef } from "@groundrule/core";
export { scanGoImports, scanJavaImports, scanJsImports, scanPyImports } from "@groundrule/core";

// ---------------------------------------------------------------- placeholders

const PLACEHOLDER = /\{([a-zA-Z_][\w-]*)\}/g;

/** A `from` pattern with `{name}` placeholders: matches a file and captures the segments. */
function fromMatcher(pattern: string): (file: string) => Record<string, string> | null {
  const names: string[] = [];
  const withTokens = pattern.replace(PLACEHOLDER, (_, name: string) => {
    names.push(name);
    return `__PH${names.length - 1}__`;
  });
  if (!names.length) {
    const test = picomatch(withTokens, { dot: true });
    return (file) => (test(file) ? {} : null);
  }
  let source = picomatch.makeRe(withTokens, { dot: true }).source;
  names.forEach((_, i) => {
    source = source.replace(`__PH${i}__`, "([^/]+)");
  });
  const re = new RegExp(source);
  return (file) => {
    const m = re.exec(file);
    if (!m) return null;
    const captured: Record<string, string> = {};
    names.forEach((n, i) => {
      captured[n] = m[i + 1] ?? "";
    });
    return captured;
  };
}

const fill = (pattern: string, captured: Record<string, string>) =>
  pattern.replace(PLACEHOLDER, (whole, name: string) => captured[name] ?? whole);

const describe = (globs: readonly string[]) => globs.join(", ");

export const importsEvaluator = defineEvaluator({
  id: "imports",
  source: "deterministic",
  description:
    "Architecture rules over import statements: layers that must not import each other, modules reachable only through their public entry, and packages only some code may use. TypeScript, JavaScript, Python, Java, Kotlin and Go.",
  optionsSchema: Options as unknown as z.ZodType<ImportOptions>,
  async evaluate({ options, context }) {
    const files = new Set(context.files);
    const targets = context.targetFiles.filter(isImportSource);
    if (!targets.length) return [];
    const read = (p: string) => readText(context.readFile, p);
    const aliases: ImportAliases = await readImportAliases(read, files);
    const fromPatterns = (options.from ?? ["**"]).map(fromMatcher);
    const packages = options.package
      ? picomatch(Array.isArray(options.package) ? options.package : [options.package], {
          dot: true,
        })
      : null;
    const only = options.only ? picomatch(options.only, { dot: true }) : null;
    const findings: EvaluatorFinding[] = [];

    for (const file of targets) {
      let captured: Record<string, string> | null = null;
      for (const match of fromPatterns) {
        captured = match(file);
        if (captured) break;
      }
      if (!captured) continue;
      const text = await read(file);
      if (text === undefined) continue;
      const index = lineIndex(text);
      const refs = scanImports(file, text);
      const forbid = options.forbid
        ? picomatch(
            options.forbid.map((g) => fill(g, captured)),
            { dot: true },
          )
        : null;
      const allow = options.allow
        ? picomatch(
            options.allow.map((g) => fill(g, captured)),
            { dot: true },
          )
        : () => false;

      for (const ref of refs) {
        const resolved = resolveImport(file, ref.specifier, aliases, files);
        let message: string | undefined;
        let evidence: string | undefined;
        if (forbid && resolved.kind === "path" && resolved.path !== file) {
          if (forbid(resolved.path) && !allow(resolved.path)) {
            message = `${file} imports ${resolved.path}: files in ${describe(options.from ?? ["**"])} must not import ${describe(options.forbid as string[])}`;
            evidence = `${file}:${ref.line} imports "${ref.specifier}", which resolves to ${resolved.path}`;
          }
        } else if (packages && resolved.kind === "package" && packages(resolved.name)) {
          if (!only || !only(file)) {
            message = `${file} imports ${resolved.name}: only ${describe(options.only as string[])} may use it`;
            evidence = `${file}:${ref.line} imports "${ref.specifier}" (package ${resolved.name})`;
          }
        }
        if (!message || !evidence) continue;
        const snippet = index.line(ref.line);
        findings.push({
          status: "violation",
          confidence: "certain",
          message: options.message ?? message,
          location: { file, startLine: ref.line },
          evidence: [evidence],
          ...(options.remediation ? { remediation: options.remediation } : {}),
          snippet: truncate(snippet),
        });
      }
    }
    return findings;
  },
});
