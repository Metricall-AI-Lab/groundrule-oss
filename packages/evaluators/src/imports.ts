// `imports`: deterministic architecture rules about who may import what (ADR 0009). Three
// shapes, all over the import statements of the files under check:
// - layers:   files matching `from` must not import repository code matching `forbid`
//             (with `allow` exceptions);
// - gates:    only files matching `only` may import a `package`;
// - placeholders: `{name}` in `from` captures a path segment and substitutes it into
//             `forbid` and `allow`, so "features don't import each other" is one rule.
// Imports are resolved to repository paths (relative paths, tsconfig/jsconfig `paths`, npm
// workspaces, Python packages); whatever can't be resolved to the repository counts as a
// package and never as a layer violation, so precision stays high.

import { defineEvaluator, type EvaluatorFinding } from "@groundrule/core";
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

const JS_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const PY_EXT = [".py"];
const isJs = (p: string) => JS_EXT.some((e) => p.endsWith(e));
const isPy = (p: string) => PY_EXT.some((e) => p.endsWith(e));

export interface ImportRef {
  /** The import specifier as written. */
  specifier: string;
  line: number;
}

/** Import statements of a TypeScript/JavaScript file: static, re-exports, require, dynamic. */
export function scanJsImports(text: string): ImportRef[] {
  const index = lineIndex(text);
  // Comments out, with newlines kept so line numbers hold.
  // Comments blanked to spaces, so offsets and line numbers stay those of the source.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p: string) => p + " ".repeat(m.length - p.length));
  const refs: ImportRef[] = [];
  const seen = new Set<string>();
  const add = (specifier: string, offset: number) => {
    const key = `${offset}:${specifier}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ specifier, line: index.lineAt(offset) });
  };
  for (const m of code.matchAll(/\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"\n]+)\1/g))
    add(m[2] as string, m.index + m[0].lastIndexOf(m[2] as string));
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"\n]+)\1/g)) add(m[2] as string, m.index);
  for (const m of code.matchAll(/\b(?:require|import)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g))
    add(m[2] as string, m.index);
  return refs.sort((a, b) => a.line - b.line);
}

/** Import statements of a Python file, as module paths ("a.b", ".sibling", "..parent"). */
export function scanPyImports(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "");
    const from = /^\s*from\s+([.\w]+)\s+import\b/.exec(line);
    if (from) {
      refs.push({ specifier: from[1] as string, line: i + 1 });
      return;
    }
    const imp = /^\s*import\s+(.+)$/.exec(line);
    if (imp)
      for (const part of (imp[1] as string).split(","))
        refs.push({ specifier: part.trim().split(/\s+as\s+/)[0] as string, line: i + 1 });
  });
  return refs.filter((r) => /^[.\w]+$/.test(r.specifier));
}

type Resolved = { kind: "path"; path: string } | { kind: "package"; name: string };

interface Aliases {
  /** tsconfig/jsconfig `paths`, as prefix/suffix pairs mapped to repository dirs. */
  paths: { prefix: string; suffix: string; targets: string[] }[];
  baseUrl: string | null;
  /** Workspace package name → directory. */
  workspaces: Map<string, string>;
}

const posix = (p: string) =>
  p
    .split("/")
    .reduce<string[]>((out, seg) => {
      if (seg === "" || seg === ".") return out;
      if (seg === "..") out.pop();
      else out.push(seg);
      return out;
    }, [])
    .join("/");
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Read alias configuration once per evaluation; every file is optional. */
async function readAliases(
  read: (p: string) => Promise<string | undefined>,
  files: ReadonlySet<string>,
): Promise<Aliases> {
  const aliases: Aliases = { paths: [], baseUrl: null, workspaces: new Map() };
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const text = await read(name);
    if (!text) continue;
    try {
      const json = JSON.parse(
        text
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "")
          .replace(/,(\s*[}\]])/g, "$1"),
      ) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const base = json.compilerOptions?.baseUrl ? posix(json.compilerOptions.baseUrl) : "";
      if (json.compilerOptions?.baseUrl) aliases.baseUrl = base;
      for (const [pattern, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        const [prefix = "", suffix = ""] = pattern.split("*");
        aliases.paths.push({
          prefix,
          suffix,
          targets: targets.map((t) => posix(`${base}/${t}`)),
        });
      }
      if (aliases.paths.length || aliases.baseUrl !== null) break;
    } catch {
      // Not JSON we understand: no aliases from it.
    }
  }
  const root = await read("package.json");
  if (root) {
    try {
      const json = JSON.parse(root) as { workspaces?: string[] | { packages?: string[] } };
      const globs = Array.isArray(json.workspaces)
        ? json.workspaces
        : (json.workspaces?.packages ?? []);
      if (globs.length) {
        const isWorkspace = picomatch(globs.map((g) => `${g.replace(/\/$/, "")}/package.json`));
        for (const file of files) {
          if (!isWorkspace(file)) continue;
          const text = await read(file);
          if (!text) continue;
          try {
            const name = (JSON.parse(text) as { name?: string }).name;
            if (name) aliases.workspaces.set(name, dirOf(file));
          } catch {
            // Skip a workspace with a broken manifest.
          }
        }
      }
    } catch {
      // No workspaces.
    }
  }
  return aliases;
}

/** The repository file an in-repo path refers to, trying extensions and index files. */
function existing(base: string, files: ReadonlySet<string>, kind: "js" | "py"): string {
  if (files.has(base)) return base;
  const exts = kind === "js" ? JS_EXT : PY_EXT;
  for (const e of exts) if (files.has(base + e)) return base + e;
  const indexes = kind === "js" ? JS_EXT.map((e) => `${base}/index${e}`) : [`${base}/__init__.py`];
  for (const i of indexes) if (files.has(i)) return i;
  return base;
}

function resolveJs(
  file: string,
  specifier: string,
  aliases: Aliases,
  files: ReadonlySet<string>,
): Resolved {
  const spec = specifier.split("?")[0] as string;
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..")
    return { kind: "path", path: existing(posix(`${dirOf(file)}/${spec}`), files, "js") };
  if (spec.startsWith("/")) return { kind: "path", path: existing(posix(spec), files, "js") };
  for (const alias of aliases.paths) {
    if (!spec.startsWith(alias.prefix) || !spec.endsWith(alias.suffix)) continue;
    const star = spec.slice(alias.prefix.length, spec.length - alias.suffix.length);
    for (const target of alias.targets) {
      const candidate = existing(posix(target.replace("*", star)), files, "js");
      if (files.has(candidate)) return { kind: "path", path: candidate };
    }
    const first = alias.targets[0];
    if (first) return { kind: "path", path: posix(first.replace("*", star)) };
  }
  const scoped = spec.startsWith("@");
  const name = spec
    .split("/")
    .slice(0, scoped ? 2 : 1)
    .join("/");
  const workspace = aliases.workspaces.get(name);
  if (workspace) {
    const rest = spec.slice(name.length).replace(/^\//, "");
    return { kind: "path", path: rest ? existing(`${workspace}/${rest}`, files, "js") : workspace };
  }
  if (aliases.baseUrl !== null) {
    const candidate = existing(posix(`${aliases.baseUrl}/${spec}`), files, "js");
    if (files.has(candidate)) return { kind: "path", path: candidate };
  }
  return { kind: "package", name };
}

function resolvePy(
  file: string,
  specifier: string,
  files: ReadonlySet<string>,
  roots: readonly string[],
): Resolved {
  const dots = specifier.match(/^\.*/)?.[0].length ?? 0;
  const rest = specifier.slice(dots).split(".").filter(Boolean).join("/");
  if (dots > 0) {
    let dir = dirOf(file);
    for (let i = 1; i < dots; i++) dir = dirOf(dir);
    return { kind: "path", path: existing(posix(rest ? `${dir}/${rest}` : dir), files, "py") };
  }
  for (const root of roots) {
    const base = posix(root ? `${root}/${rest}` : rest);
    const found = existing(base, files, "py");
    if (files.has(found)) return { kind: "path", path: found };
  }
  return { kind: "package", name: specifier.split(".")[0] as string };
}

/** Python import roots: the repository, `src`, and any top-level package directory's parent. */
function pythonRoots(files: ReadonlySet<string>): string[] {
  const roots = new Set<string>([""]);
  for (const f of files) {
    if (!f.endsWith("/__init__.py")) continue;
    const pkg = dirOf(f);
    const parent = dirOf(pkg);
    if (parent === "" || parent === "src" || !parent.includes("/")) roots.add(parent);
  }
  roots.add("src");
  return [...roots];
}

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
    "Architecture rules over import statements: layers that must not import each other, modules reachable only through their public entry, and packages only some code may use. TypeScript, JavaScript and Python.",
  optionsSchema: Options as unknown as z.ZodType<ImportOptions>,
  async evaluate({ options, context }) {
    const files = new Set(context.files);
    const targets = context.targetFiles.filter((f) => isJs(f) || isPy(f));
    if (!targets.length) return [];
    const read = (p: string) => readText(context.readFile, p);
    const aliases = targets.some(isJs) ? await readAliases(read, files) : null;
    const roots = targets.some(isPy) ? pythonRoots(files) : [];
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
      const refs = isJs(file) ? scanJsImports(text) : scanPyImports(text);
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
        const resolved = isJs(file)
          ? resolveJs(file, ref.specifier, aliases as Aliases, files)
          : resolvePy(file, ref.specifier, files, roots);
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
