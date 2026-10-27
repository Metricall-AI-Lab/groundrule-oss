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

/** One resolved import, as the evaluator or a stored graph (RFC 0015) sees it. */
export interface ResolvedEdge {
  file: string;
  line: number;
  /** The import as written; absent in a stored graph. */
  specifier?: string;
  resolved: { kind: "path"; path: string } | { kind: "package"; name: string };
}

/**
 * The rule's matching, compiled once: `test` says whether an edge violates it and how. Shared
 * by the evaluator (over files it reads) and `previewImports` (over a stored graph).
 */
export function compileImportRule(options: ImportOptions) {
  const fromPatterns = (options.from ?? ["**"]).map(fromMatcher);
  const packages = options.package
    ? picomatch(Array.isArray(options.package) ? options.package : [options.package], {
        dot: true,
      })
    : null;
  const only = options.only ? picomatch(options.only, { dot: true }) : null;
  const fromText = describe(options.from ?? ["**"]);
  return {
    /** The captures when the file is one the rule applies to, else null. */
    applies(file: string): Record<string, string> | null {
      for (const match of fromPatterns) {
        const captured = match(file);
        if (captured) return captured;
      }
      return null;
    },
    test(
      edge: ResolvedEdge,
      captured: Record<string, string>,
    ): { message: string; evidence: string } | null {
      const written = edge.specifier ? `"${edge.specifier}"` : "an import";
      if (options.forbid && edge.resolved.kind === "path" && edge.resolved.path !== edge.file) {
        const forbid = picomatch(
          options.forbid.map((g) => fill(g, captured)),
          { dot: true },
        );
        const allow = options.allow
          ? picomatch(
              options.allow.map((g) => fill(g, captured)),
              { dot: true },
            )
          : () => false;
        if (forbid(edge.resolved.path) && !allow(edge.resolved.path))
          return {
            message: `${edge.file} imports ${edge.resolved.path}: files in ${fromText} must not import ${describe(options.forbid)}`,
            evidence: `${edge.file}:${edge.line} imports ${written}, which resolves to ${edge.resolved.path}`,
          };
        return null;
      }
      if (packages && edge.resolved.kind === "package" && packages(edge.resolved.name)) {
        if (!only || !only(edge.file))
          return {
            message: `${edge.file} imports ${edge.resolved.name}: only ${describe(options.only as string[])} may use it`,
            evidence: `${edge.file}:${edge.line} imports ${written} (package ${edge.resolved.name})`,
          };
      }
      return null;
    },
  };
}

export interface ImportPreview {
  /** Imports that would violate the rule. */
  violations: number;
  /** Distinct files with at least one. */
  files: number;
  /** Files the rule applies to (matching `from`) that have imports. */
  applicable: number;
  examples: { file: string; line: number; target: string }[];
}

/** What an `imports` rule would report today over a stored graph (RFC 0015). Never throws for bad options: validate first. */
export function previewImports(
  options: unknown,
  edges: readonly {
    file: string;
    line: number;
    path?: string | undefined;
    package?: string | undefined;
  }[],
  maxExamples = 5,
): ImportPreview {
  const parsed = Options.parse(options);
  const rule = compileImportRule(parsed);
  const files = new Set<string>();
  const applicable = new Set<string>();
  const examples: ImportPreview["examples"] = [];
  let violations = 0;
  for (const e of edges) {
    const captured = rule.applies(e.file);
    if (!captured) continue;
    applicable.add(e.file);
    const resolved = e.path
      ? ({ kind: "path", path: e.path } as const)
      : ({ kind: "package", name: e.package ?? "" } as const);
    if (!rule.test({ file: e.file, line: e.line, resolved }, captured)) continue;
    violations++;
    files.add(e.file);
    if (examples.length < maxExamples)
      examples.push({
        file: e.file,
        line: e.line,
        target: resolved.kind === "path" ? resolved.path : resolved.name,
      });
  }
  return { violations, files: files.size, applicable: applicable.size, examples };
}

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
    const rule = compileImportRule(options);
    const findings: EvaluatorFinding[] = [];

    for (const file of targets) {
      const captured = rule.applies(file);
      if (!captured) continue;
      const text = await read(file);
      if (text === undefined) continue;
      const index = lineIndex(text);
      for (const ref of scanImports(file, text)) {
        const resolved = resolveImport(file, ref.specifier, aliases, files);
        const hit = rule.test(
          { file, line: ref.line, specifier: ref.specifier, resolved },
          captured,
        );
        if (!hit) continue;
        findings.push({
          status: "violation",
          confidence: "certain",
          message: options.message ?? hit.message,
          location: { file, startLine: ref.line },
          evidence: [hit.evidence],
          ...(options.remediation ? { remediation: options.remediation } : {}),
          snippet: truncate(index.line(ref.line)),
        });
      }
    }
    return findings;
  },
});
