// Layout discovery (RFC 0016): the conventions a repository already keeps about where a kind
// of file lives and which companion every source file has, as proposed `layout` rules with
// the files that would fail each today.
import { createHash } from "node:crypto";
import picomatch from "picomatch";
import { dirOf, isGoFile, isJavaFile, isJsFile, isPyFile } from "./import-graph.js";

export interface LayoutProposal {
  kind: "place" | "companion";
  from: string[];
  exclude?: string[];
  place?: string[];
  companion?: string[];
  files: number;
  violations: number;
  examples: { file: string }[];
  fingerprint: string;
}

const MIN_KIND_FILES = 3;
const MIN_COMPANION_FILES = 5;
const MIN_SHARE = 0.8;
const MAX_LAYOUTS = 15;
const MAX_EXAMPLES = 3;

/** Directory names that are roots, never a place a kind of file "lives". */
const NOT_A_PLACE = new Set([
  "src",
  "app",
  "lib",
  "source",
  "main",
  "test",
  "java",
  "kotlin",
  "internal",
  "pkg",
  "cmd",
  "packages",
  "apps",
  "libs",
  "services",
  "modules",
  "com",
  "org",
  "io",
  "net",
  "node_modules",
  "vendor",
  "dist",
  "build",
]);
const NOT_A_KIND = new Set([
  "test",
  "tests",
  "spec",
  "d",
  "stories",
  "story",
  "config",
  "module",
  "mock",
  "mocks",
  "min",
  "generated",
  "pb",
  "g",
]);
const UNDERSCORE_KINDS = new Set([
  "handler",
  "handlers",
  "controller",
  "service",
  "repository",
  "repo",
  "store",
  "client",
  "worker",
  "job",
  "middleware",
  "router",
  "routes",
  "model",
  "models",
  "schema",
  "view",
  "views",
]);
const CAMEL_KINDS = new Set([
  "Controller",
  "Resource",
  "Handler",
  "Service",
  "Repository",
  "Dao",
  "Client",
  "Job",
  "Listener",
  "Filter",
  "Interceptor",
  "Mapper",
  "Entity",
  "Dto",
  "Config",
  "Configuration",
]);

const fingerprint = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\0")).digest("hex");
const nameOf = (file: string) => file.slice(file.lastIndexOf("/") + 1);

/** The kind of a file by its name's suffix, as a glob, or null. */
export function kindOf(file: string): string | null {
  const name = nameOf(file);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot);
  const base = name.slice(0, dot);
  const dotted = base.lastIndexOf(".");
  if (dotted > 0) {
    const suffix = base.slice(dotted + 1);
    if (/^[a-z][a-z0-9-]*$/.test(suffix) && !NOT_A_KIND.has(suffix)) return `*.${suffix}${ext}`;
    return null;
  }
  const under = base.lastIndexOf("_");
  if (under > 0) {
    const suffix = base.slice(under + 1);
    if (UNDERSCORE_KINDS.has(suffix)) return `*_${suffix}${ext}`;
    return null;
  }
  const camel = /^[A-Z][A-Za-z0-9]*?([A-Z][a-z]+)$/.exec(base);
  if (camel?.[1] && CAMEL_KINDS.has(camel[1]) && base !== camel[1]) return `*${camel[1]}${ext}`;
  return null;
}

/** Test conventions per language family, in the layout check's companion syntax. */
const COMPANIONS: {
  family: string;
  is: (f: string) => boolean;
  /** Source files: not tests, not scaffolding. */
  subject: (f: string) => boolean;
  exclude: string[];
  patterns: string[];
}[] = [
  {
    family: "js",
    is: isJsFile,
    subject: (f) =>
      !/\.(test|spec|stories|d|config)\.[cm]?[jt]sx?$/.test(f) &&
      !/(^|\/)(index\.[cm]?[jt]sx?|.*\.config\.[cm]?[jt]s|.*rc\.[cm]?js)$/.test(f) &&
      !/(^|\/)(__tests__|__mocks__|tests?|spec|types?|node_modules|dist|build)\//.test(f),
    exclude: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/*.d.ts",
      "**/index.*",
      "**/*.stories.*",
      "**/*.config.*",
      "**/__tests__/**",
      "**/__mocks__/**",
    ],
    patterns: [
      "{dir}/{base}.test{ext}",
      "{dir}/{base}.spec{ext}",
      "{dir}/__tests__/{base}.test{ext}",
      "tests/**/{base}.test{ext}",
      "test/**/{base}.test{ext}",
    ],
  },
  {
    family: "py",
    is: isPyFile,
    subject: (f) =>
      !/(^|\/)(test_[^/]*|[^/]*_test|__init__|conftest|setup|manage|wsgi|asgi)\.py$/.test(f) &&
      !/(^|\/)(tests?|migrations)\//.test(f),
    exclude: [
      "**/test_*.py",
      "**/*_test.py",
      "**/__init__.py",
      "**/conftest.py",
      "**/migrations/**",
    ],
    patterns: ["{dir}/test_{name}", "{dir}/tests/test_{name}", "tests/**/test_{name}"],
  },
  {
    family: "go",
    is: isGoFile,
    subject: (f) => !f.endsWith("_test.go") && !/(^|\/)(vendor|testdata)\//.test(f),
    exclude: ["**/*_test.go", "**/testdata/**"],
    patterns: ["{dir}/{base}_test.go"],
  },
  {
    family: "jvm",
    is: isJavaFile,
    subject: (f) => /(^|\/)src\/main\/(java|kotlin)\//.test(f),
    exclude: ["**/src/test/**"],
    patterns: [
      "src/test/**/{base}Test{ext}",
      "src/test/**/{base}Tests{ext}",
      "src/test/**/{base}Spec{ext}",
    ],
  },
];

const fill = (pattern: string, file: string) => {
  const dir = dirOf(file);
  const name = nameOf(file);
  const dot = name.lastIndexOf(".");
  return pattern
    .replace(/\{dir\}/g, dir)
    .replace(/\{base\}/g, dot > 0 ? name.slice(0, dot) : name)
    .replace(/\{name\}/g, name)
    .replace(/\{ext\}/g, dot > 0 ? name.slice(dot) : "")
    .replace(/^\/+/, "");
};

/** The companion `pattern` resolves to for `file`, found among `files`. */
function hasCompanion(
  file: string,
  pattern: string,
  files: readonly string[],
  set: ReadonlySet<string>,
) {
  const expected = fill(pattern, file);
  return expected.includes("*")
    ? files.some((f) => picomatch.isMatch(f, expected, { dot: true }))
    : set.has(expected);
}

export function discoverLayout(files: readonly string[]): LayoutProposal[] {
  const out: LayoutProposal[] = [];
  const set = new Set(files);

  // Places: a kind of file and the directory name most of them live under.
  const byKind = new Map<string, string[]>();
  for (const f of files) {
    const kind = kindOf(f);
    if (kind) (byKind.get(kind) ?? byKind.set(kind, []).get(kind))?.push(f);
  }
  for (const [kind, members] of byKind) {
    if (members.length < MIN_KIND_FILES) continue;
    const bySegment = new Map<string, number>();
    for (const f of members)
      for (const seg of new Set(dirOf(f).split("/").filter(Boolean)))
        if (!NOT_A_PLACE.has(seg)) bySegment.set(seg, (bySegment.get(seg) ?? 0) + 1);
    const best = [...bySegment].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best || best[1] < members.length * MIN_SHARE) continue;
    const place = `**/${best[0]}/**`;
    const under = picomatch(place, { dot: true });
    const violating = members.filter((f) => !under(f));
    out.push({
      kind: "place",
      from: [`**/${kind}`],
      place: [place],
      files: members.length,
      violations: violating.length,
      examples: violating.slice(0, MAX_EXAMPLES).map((file) => ({ file })),
      fingerprint: fingerprint("layout", "place", `**/${kind}`, place),
    });
  }

  // Companions: per family, the test convention most source files follow.
  for (const c of COMPANIONS) {
    const subjects = files.filter((f) => c.is(f) && c.subject(f));
    if (subjects.length < MIN_COMPANION_FILES) continue;
    let best: { pattern: string; covered: string[] } | null = null;
    for (const pattern of c.patterns) {
      const covered = subjects.filter((f) => hasCompanion(f, pattern, files, set));
      if (!best || covered.length > best.covered.length) best = { pattern, covered };
    }
    if (!best || best.covered.length < subjects.length * MIN_SHARE) continue;
    const coveredSet = new Set(best.covered);
    const violating = subjects.filter((f) => !coveredSet.has(f));
    // `from`: the top-level directories the subjects live in, with the family's extensions.
    const tops = [...new Set(subjects.map((f) => f.split("/")[0]))].filter((t) => t && !set.has(t));
    const exts = [
      ...new Set(subjects.map((f) => nameOf(f).slice(nameOf(f).lastIndexOf(".")))),
    ].sort();
    const extGlob = exts.length === 1 ? exts[0] : `.{${exts.map((e) => e.slice(1)).join(",")}}`;
    const from = (tops.length ? tops.sort() : ["."]).map((t) =>
      t === "." ? `**/*${extGlob}` : `${t}/**/*${extGlob}`,
    );
    out.push({
      kind: "companion",
      from,
      exclude: c.exclude,
      companion: [best.pattern],
      files: subjects.length,
      violations: violating.length,
      examples: violating.slice(0, MAX_EXAMPLES).map((file) => ({ file })),
      fingerprint: fingerprint("layout", "companion", from.join(","), best.pattern),
    });
  }
  return out
    .sort((a, b) => b.files - a.files || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, MAX_LAYOUTS);
}
