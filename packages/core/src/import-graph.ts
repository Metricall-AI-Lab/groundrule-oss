// Import statements and what they point at (ADR 0009): the primitive behind the `imports`
// check and architecture discovery. Imports are scanned with tolerant patterns (they are
// syntactically simple) and resolved to repository paths through relative paths,
// tsconfig/jsconfig `paths`, npm workspaces and Python packages. Whatever doesn't resolve to
// the repository is a package, never an in-repository path.

import picomatch from "picomatch";

export const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
export const PY_EXTENSIONS = [".py"];
export const isJsFile = (p: string) => JS_EXTENSIONS.some((e) => p.endsWith(e));
export const isPyFile = (p: string) => PY_EXTENSIONS.some((e) => p.endsWith(e));

export interface ImportRef {
  /** The import specifier as written. */
  specifier: string;
  line: number;
}

export type ResolvedImport = { kind: "path"; path: string } | { kind: "package"; name: string };

/** 1-based line of a character offset. */
function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Import statements of a TypeScript/JavaScript file: static, re-exports, require, dynamic. */
export function scanJsImports(text: string): ImportRef[] {
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
    refs.push({ specifier, line: lineOf(code, offset) });
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
  text.split("\n").forEach((raw, i) => {
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

export interface ImportAliases {
  /** tsconfig/jsconfig `paths`, as prefix/suffix pairs mapped to repository dirs. */
  paths: { prefix: string; suffix: string; targets: string[] }[];
  baseUrl: string | null;
  /** Workspace package name → directory. */
  workspaces: Map<string, string>;
  /** Python import roots. */
  pythonRoots: string[];
}

export const posixJoin = (p: string) =>
  p
    .split("/")
    .reduce<string[]>((out, seg) => {
      if (seg === "" || seg === ".") return out;
      if (seg === "..") out.pop();
      else out.push(seg);
      return out;
    }, [])
    .join("/");
export const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

type Reader = (path: string) => Promise<string | undefined>;

/** Alias configuration, read once; every file is optional. */
export async function readImportAliases(
  read: Reader,
  files: ReadonlySet<string>,
): Promise<ImportAliases> {
  const aliases: ImportAliases = {
    paths: [],
    baseUrl: null,
    workspaces: new Map(),
    pythonRoots: [],
  };
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const text = await read(name);
    if (!text) continue;
    try {
      const json = JSON.parse(
        text
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "")
          .replace(/,(\s*[}\]])/g, "$1"),
      ) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const base = json.compilerOptions?.baseUrl ? posixJoin(json.compilerOptions.baseUrl) : "";
      if (json.compilerOptions?.baseUrl) aliases.baseUrl = base;
      for (const [pattern, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        const [prefix = "", suffix = ""] = pattern.split("*");
        aliases.paths.push({
          prefix,
          suffix,
          targets: targets.map((t) => posixJoin(`${base}/${t}`)),
        });
      }
      if (aliases.paths.length || aliases.baseUrl !== null) break;
    } catch {
      // Not JSON we understand: no aliases from it.
    }
  }
  // Workspaces: npm/yarn `workspaces` in package.json, or pnpm-workspace.yaml's `packages`.
  const globs: string[] = [];
  const root = await read("package.json");
  if (root) {
    try {
      const json = JSON.parse(root) as { workspaces?: string[] | { packages?: string[] } };
      globs.push(
        ...(Array.isArray(json.workspaces) ? json.workspaces : (json.workspaces?.packages ?? [])),
      );
    } catch {
      // No workspaces.
    }
  }
  const pnpm = await read("pnpm-workspace.yaml");
  if (pnpm) {
    let inPackages = false;
    for (const line of pnpm.split("\n")) {
      if (/^packages\s*:/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages && /^\S/.test(line)) inPackages = false;
      const item = inPackages ? /^\s+-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line) : null;
      if (item?.[1] && !item[1].startsWith("!")) globs.push(item[1]);
    }
  }
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
        // A workspace with a broken manifest: skipped.
      }
    }
  }
  // Python roots: the repository, `src`, and the parent of every top-level package.
  const roots = new Set<string>([""]);
  for (const f of files) {
    if (!f.endsWith("/__init__.py")) continue;
    const parent = dirOf(dirOf(f));
    if (parent === "" || parent === "src" || !parent.includes("/")) roots.add(parent);
  }
  roots.add("src");
  aliases.pythonRoots = [...roots];
  return aliases;
}

/** The repository file an in-repository path refers to, trying extensions and index files. */
function existing(base: string, files: ReadonlySet<string>, kind: "js" | "py"): string {
  if (files.has(base)) return base;
  const exts = kind === "js" ? JS_EXTENSIONS : PY_EXTENSIONS;
  for (const e of exts) if (files.has(base + e)) return base + e;
  const indexes =
    kind === "js" ? JS_EXTENSIONS.map((e) => `${base}/index${e}`) : [`${base}/__init__.py`];
  for (const i of indexes) if (files.has(i)) return i;
  return base;
}

export function resolveImport(
  file: string,
  specifier: string,
  aliases: ImportAliases,
  files: ReadonlySet<string>,
): ResolvedImport {
  if (isPyFile(file)) {
    const dots = specifier.match(/^\.*/)?.[0].length ?? 0;
    const rest = specifier.slice(dots).split(".").filter(Boolean).join("/");
    if (dots > 0) {
      let dir = dirOf(file);
      for (let i = 1; i < dots; i++) dir = dirOf(dir);
      return {
        kind: "path",
        path: existing(posixJoin(rest ? `${dir}/${rest}` : dir), files, "py"),
      };
    }
    for (const root of aliases.pythonRoots) {
      const found = existing(posixJoin(root ? `${root}/${rest}` : rest), files, "py");
      if (files.has(found)) return { kind: "path", path: found };
    }
    return { kind: "package", name: specifier.split(".")[0] as string };
  }
  const spec = specifier.split("?")[0] as string;
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..")
    return { kind: "path", path: existing(posixJoin(`${dirOf(file)}/${spec}`), files, "js") };
  if (spec.startsWith("/")) return { kind: "path", path: existing(posixJoin(spec), files, "js") };
  for (const alias of aliases.paths) {
    if (!spec.startsWith(alias.prefix) || !spec.endsWith(alias.suffix)) continue;
    const star = spec.slice(alias.prefix.length, spec.length - alias.suffix.length);
    for (const target of alias.targets) {
      const candidate = existing(posixJoin(target.replace("*", star)), files, "js");
      if (files.has(candidate)) return { kind: "path", path: candidate };
    }
    const first = alias.targets[0];
    if (first) return { kind: "path", path: posixJoin(first.replace("*", star)) };
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
    const candidate = existing(posixJoin(`${aliases.baseUrl}/${spec}`), files, "js");
    if (files.has(candidate)) return { kind: "path", path: candidate };
  }
  return { kind: "package", name };
}

export interface ImportEdge {
  file: string;
  line: number;
  specifier: string;
  resolved: ResolvedImport;
}

/** Every import of every TypeScript, JavaScript and Python file given, resolved. */
export async function buildImportGraph(
  files: readonly string[],
  read: Reader,
  options: { only?: readonly string[] } = {},
): Promise<{ edges: ImportEdge[]; aliases: ImportAliases }> {
  const all = new Set(files);
  const aliases = await readImportAliases(read, all);
  const edges: ImportEdge[] = [];
  for (const file of options.only ?? files) {
    if (!isJsFile(file) && !isPyFile(file)) continue;
    const text = await read(file);
    if (text === undefined) continue;
    const refs = isJsFile(file) ? scanJsImports(text) : scanPyImports(text);
    for (const ref of refs)
      edges.push({
        file,
        line: ref.line,
        specifier: ref.specifier,
        resolved: resolveImport(file, ref.specifier, aliases, all),
      });
  }
  return { edges, aliases };
}
