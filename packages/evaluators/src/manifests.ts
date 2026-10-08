/** Dependency declarations parsed from package manifests, with line numbers. */
export type Ecosystem = "npm" | "maven" | "gradle" | "pip" | "go" | "cargo";

export interface Dependency {
  ecosystem: Ecosystem;
  /** npm: name; maven/gradle: group:artifact; pip: normalized name; go: module path; cargo: crate. */
  name: string;
  line: number;
}

export function manifestEcosystem(path: string): Ecosystem | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "package.json") return "npm";
  if (name === "pom.xml") return "maven";
  if (name === "build.gradle" || name === "build.gradle.kts") return "gradle";
  if (name === "pyproject.toml" || /^requirements[^/]*\.txt$/.test(name)) return "pip";
  if (name === "go.mod") return "go";
  if (name === "Cargo.toml") return "cargo";
  return undefined;
}

export function parseManifest(path: string, text: string): Dependency[] {
  const ecosystem = manifestEcosystem(path);
  const lines = text.split("\n");
  switch (ecosystem) {
    case "npm":
      return parseNpm(text, lines);
    case "maven":
      return parseMaven(lines);
    case "gradle":
      return parseGradle(lines);
    case "pip":
      return path.endsWith(".toml") ? parsePyproject(lines) : parseRequirements(lines);
    case "go":
      return parseGoMod(lines);
    case "cargo":
      return parseCargo(lines);
    default:
      return [];
  }
}

const NPM_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function parseNpm(text: string, lines: string[]): Dependency[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const section of NPM_SECTIONS) {
    const deps = pkg[section];
    if (deps && typeof deps === "object") for (const name of Object.keys(deps)) names.add(name);
  }
  return [...names].map((name) => {
    const key = `"${name}"`;
    const index = lines.findIndex(
      (l) => l.includes(key) && /"\s*:/.test(l.slice(l.indexOf(key) + key.length - 1)),
    );
    return { ecosystem: "npm" as const, name, line: index + 1 || 1 };
  });
}

function parseMaven(lines: string[]): Dependency[] {
  const deps: Dependency[] = [];
  let inDependency = false;
  let group = "";
  for (const [i, line] of lines.entries()) {
    if (/<dependency>/.test(line)) {
      inDependency = true;
      group = "";
    }
    if (!inDependency) continue;
    const g = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(line);
    if (g?.[1]) group = g[1];
    const a = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(line);
    if (a?.[1])
      deps.push({ ecosystem: "maven", name: group ? `${group}:${a[1]}` : a[1], line: i + 1 });
    if (/<\/dependency>/.test(line)) inDependency = false;
  }
  return deps;
}

const GRADLE =
  /\b(?:implementation|api|compileOnly|runtimeOnly|annotationProcessor|kapt|testImplementation|testRuntimeOnly|testCompileOnly)\s*\(?\s*["']([^:"'\s]+):([^:"'\s]+)(?::[^"']*)?["']/;

function parseGradle(lines: string[]): Dependency[] {
  const deps: Dependency[] = [];
  for (const [i, line] of lines.entries()) {
    const m = GRADLE.exec(line);
    if (m?.[1] && m[2]) deps.push({ ecosystem: "gradle", name: `${m[1]}:${m[2]}`, line: i + 1 });
  }
  return deps;
}

/** PEP 503 normalization: lowercase, runs of -_. become -. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

const PEP508_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

function parseRequirements(lines: string[]): Dependency[] {
  const deps: Dependency[] = [];
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue;
    const m = PEP508_NAME.exec(line);
    if (m?.[1]) deps.push({ ecosystem: "pip", name: normalizePythonName(m[1]), line: i + 1 });
  }
  return deps;
}

function parsePyproject(lines: string[]): Dependency[] {
  const deps: Dependency[] = [];
  let section = "";
  let inArray = false;
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/#.*$/, "");
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header?.[1]) {
      section = header[1].trim();
      inArray = false;
      continue;
    }
    // PEP 621: dependencies = [...] and optional-dependencies tables
    if (
      /^\s*(dependencies|[A-Za-z0-9_-]+)\s*=\s*\[/.test(line) &&
      (section === "project" || section === "project.optional-dependencies")
    ) {
      if (section === "project" && !/^\s*dependencies\s*=/.test(line)) continue;
      inArray = true;
    }
    if (inArray) {
      for (const m of line.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)[^"']*["']/g)) {
        if (m[1]) deps.push({ ecosystem: "pip", name: normalizePythonName(m[1]), line: i + 1 });
      }
      if (line.includes("]")) inArray = false;
      continue;
    }
    // Poetry: [tool.poetry.dependencies] / [tool.poetry.group.x.dependencies]
    if (/^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/.test(section)) {
      const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
      if (m?.[1] && m[1] !== "python")
        deps.push({ ecosystem: "pip", name: normalizePythonName(m[1]), line: i + 1 });
    }
  }
  return deps;
}

function parseGoMod(lines: string[]): Dependency[] {
  const deps: Dependency[] = [];
  let inBlock = false;
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const m = inBlock ? /^(\S+)\s+v\S+/.exec(line) : /^require\s+(\S+)\s+v\S+/.exec(line);
    if (m?.[1]) deps.push({ ecosystem: "go", name: m[1], line: i + 1 });
  }
  return deps;
}

function parseCargo(lines: string[]): Dependency[] {
  const deps: Dependency[] = [];
  let section = "";
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/#.*$/, "");
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header?.[1]) {
      section = header[1].trim();
      const inline = /^(?:target\.[^.]+\.)?(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/.exec(
        section,
      );
      if (inline?.[1]) deps.push({ ecosystem: "cargo", name: inline[1], line: i + 1 });
      continue;
    }
    if (/^(?:target\.[^.]+\.)?(?:dev-|build-)?dependencies$/.test(section)) {
      const m = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
      if (m?.[1]) deps.push({ ecosystem: "cargo", name: m[1], line: i + 1 });
    }
  }
  return deps;
}
