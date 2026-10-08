// Importers (B2): turn what a repository already has into proposals, deterministically.
// - Agent instruction files → instructions, split by heading and list item, with sources.
// - Linter and compiler settings → the catalog rules they already enforce (or turn off).
// - CODEOWNERS → who owns which kind of rule.
// Configuration files are read as text and never executed.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ImportedInstruction,
  ImportedOwner,
  ImportedToolSetting,
  ScanAgentFile,
} from "@groundrule/spec";
import { parse as parseYaml } from "yaml";
import { stripManagedBlocks } from "./generated.js";
import type { LoadedStandard } from "./workspace.js";

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export interface SplitInstruction {
  text: string;
  section?: string;
  strength: ImportedInstruction["strength"];
  startLine: number;
  endLine: number;
}

const MUST = /\b(must|never|always|do not|don't|dont|required?|forbidden|only)\b|^no\s/i;
const SHOULD = /\b(should|prefer|avoid|try to|recommended|ideally|keep|ensure|use)\b/i;
/** A paragraph counts when a sentence starts with a directive, not when one appears in passing. */
const DIRECTIVE =
  /(^|[.;:!?]\s+)(must|never|always|do not|don't|avoid|prefer|should|ensure|keep|use|only|run|write|add|put|make|validate|treat|follow|ask|check|don't)\b/i;
/** Items that start with an imperative verb ask for something, even without "must". */
const IMPERATIVE =
  /^(use|keep|run|write|add|put|make|validate|treat|follow|ask|check|prefer|avoid|ensure|ship|test|log|handle|wrap|pass|name|document|update|return|throw|call|create|split|store|read|load|set|limit|start|stop|wait|mock|review|fix|commit|import|export|declare|type|await)\b/i;
/\b(must|never|always|do not|don't|avoid|prefer|should|ensure|required?|keep|only|use)\b/i;
/** Sections that describe the repository rather than how to work in it. */
const DESCRIPTIVE_SECTION =
  /\b(layout|structure|commands?|setup|install(ation)?|getting started|overview|links?|references?|table of contents|contents)\b/i;

/** Readable text: markdown links, emphasis, and HTML comments removed; code kept. */
function clean(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeInstruction(text: string): string {
  return (
    clean(text)
      .toLowerCase()
      .replace(/[`"'“”‘’]/g, "")
      .replace(/[^\p{L}\p{N}@./_-]+/gu, " ")
      // Sentence punctuation isn't meaning; dots inside names (console.log) are.
      .replace(/[.]+(?=\s|$)/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export const instructionFingerprint = (text: string) =>
  createHash("sha256").update(normalizeInstruction(text)).digest("hex");

function strengthOf(text: string): SplitInstruction["strength"] {
  if (MUST.test(text)) return "must";
  if (SHOULD.test(text) || IMPERATIVE.test(text)) return "should";
  return "info";
}

/** Front matter (Cursor .mdc globs, Copilot applyTo) becomes a path scope. */
function frontMatter(text: string): { body: string; offset: number; paths?: string[] } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { body: text, offset: 0 };
  let paths: string[] | undefined;
  try {
    const data = parseYaml(match[1] ?? "") as Record<string, unknown> | null;
    const raw = data?.globs ?? data?.applyTo;
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
    const cleaned = list
      .map((g) => String(g).trim())
      .filter((g) => g && g !== "**" && g !== "**/*")
      .slice(0, 20);
    if (cleaned.length) paths = cleaned;
  } catch {
    // Unreadable front matter: keep the body, skip the scope.
  }
  const offset = (match[0].match(/\n/g) ?? []).length;
  return { body: text.slice(match[0].length), offset, ...(paths ? { paths } : {}) };
}

/**
 * Split an instruction file into candidate rules: each top-level list item (with its
 * continuation lines and nested points) and each standalone directive paragraph.
 * Skips code blocks, tables, Groundrule-managed blocks, `@file` imports, and sections
 * that describe the repository (Commands, Layout, ...).
 */
export function splitInstructions(raw: string): { items: SplitInstruction[]; paths?: string[] } {
  const { body, offset, paths } = frontMatter(stripManagedBlocks(raw));
  const lines = body.split("\n");
  const items: SplitInstruction[] = [];
  const headings: string[] = [];
  let fence: string | null = null;
  let current: {
    parts: string[];
    /** Nested points under a list item. */
    subs: string[];
    start: number;
    end: number;
    list: boolean;
  } | null = null;

  // The document title (a level-1 heading) says nothing about one instruction.
  const section = () => {
    const path = headings.slice(1).filter(Boolean).join(" › ");
    return path ? path.slice(0, 200) : undefined;
  };
  const flush = () => {
    if (!current) return;
    const main = clean(current.parts.join(" "));
    const text = (
      current.subs.length
        ? `${main.replace(/[.:]$/, "")} — ${current.subs.map(clean).join("; ")}`
        : main
    ).slice(0, 1000);
    const descriptive = DESCRIPTIVE_SECTION.test(headings.at(-1) ?? "");
    const keep =
      text.length >= 12 &&
      !/^@\S+$/.test(text) &&
      !descriptive &&
      (current.list ? /[a-z]/i.test(text) : text.length <= 400 && DIRECTIVE.test(text));
    if (keep) {
      const s = section();
      items.push({
        text,
        ...(s ? { section: s } : {}),
        strength: strengthOf(text),
        startLine: current.start + offset,
        endLine: current.end + offset,
      });
    }
    current = null;
  };

  lines.forEach((line, i) => {
    const n = i + 1;
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (fenceMatch && line.trim().startsWith(fence)) fence = null;
      return;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1] ?? "```";
      return;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      headings.length = level - 1;
      headings[level - 1] = clean(heading[2] ?? "");
      return;
    }
    if (/^\s*\|/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      return;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const indent = item[1]?.length ?? 0;
      if (indent < 2 || !current) {
        flush();
        current = { parts: [item[3] ?? ""], subs: [], start: n, end: n, list: true };
      } else {
        current.subs.push(item[3] ?? "");
        current.end = n;
      }
      return;
    }
    if (!line.trim()) {
      // Paragraphs end at blank lines; list items may continue after one if indented.
      if (current && !current.list) flush();
      return;
    }
    if (current && (current.list ? /^\s{2,}/.test(line) || current.end === n - 1 : true)) {
      current.parts.push(line.trim());
      current.end = n;
      return;
    }
    flush();
    current = { parts: [line.trim()], subs: [], start: n, end: n, list: false };
  });
  flush();
  return { items, ...(paths ? { paths } : {}) };
}

// ---------------------------------------------------------------------------
// Similar catalog rules (keyword match, TF-IDF cosine; never AI)
// ---------------------------------------------------------------------------

const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the this to with your you we our not no do don't dont never always must should use using only all any can will when where which what who each every than then them they there these those via per if so but be been being also more most other some such same own make sure keep".split(
    " ",
  ),
);

function tokens(text: string): string[] {
  return normalizeInstruction(text)
    .split(" ")
    .map((t) => t.replace(/^[./_-]+|[./_-]+$/g, ""))
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export interface StandardIndex {
  match(text: string, limit?: number): { id: string; score: number }[];
}

export function indexStandards(standards: readonly LoadedStandard[]): StandardIndex {
  const docs = standards.map((s) => {
    const { metadata, spec } = s.standard;
    const words = tokens(
      [metadata.title, metadata.title, spec.requirement, spec.agent?.summary ?? ""].join(" "),
    );
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { id: metadata.id, tf };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log((docs.length + 1) / ((df.get(w) ?? 0) + 1)) + 1;
  const vectors = docs.map((d) => {
    const v = new Map<string, number>();
    let norm = 0;
    for (const [w, n] of d.tf) {
      const x = n * idf(w);
      v.set(w, x);
      norm += x * x;
    }
    return { id: d.id, v, norm: Math.sqrt(norm) || 1 };
  });
  return {
    match(text, limit = 3) {
      const q = new Map<string, number>();
      for (const w of tokens(text)) q.set(w, (q.get(w) ?? 0) + idf(w));
      let qn = 0;
      for (const x of q.values()) qn += x * x;
      qn = Math.sqrt(qn) || 1;
      return vectors
        .map(({ id, v, norm }) => {
          let dot = 0;
          for (const [w, x] of q) dot += x * (v.get(w) ?? 0);
          return { id, score: Math.round((dot / (qn * norm)) * 100) / 100 };
        })
        .filter((m) => m.score >= 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
}

/** Instructions from every agent file, de-duplicated across files by normalized text. */
export async function importInstructions(
  root: string,
  agentFiles: readonly ScanAgentFile[],
  index: StandardIndex,
  redact: (text: string) => string = (t) => t,
): Promise<ImportedInstruction[]> {
  const byPrint = new Map<string, ImportedInstruction>();
  for (const file of agentFiles) {
    const text = await readFile(join(root, file.path), "utf8").catch(() => null);
    if (text === null) continue;
    const { items, paths } = splitInstructions(text);
    for (const item of items) {
      const fingerprint = instructionFingerprint(item.text);
      const source = { file: file.path, startLine: item.startLine, endLine: item.endLine };
      const existing = byPrint.get(fingerprint);
      if (existing) {
        if (existing.sources.length < 10) existing.sources.push(source);
        continue;
      }
      if (byPrint.size >= 500) continue;
      byPrint.set(fingerprint, {
        text: redact(item.text),
        ...(item.section ? { section: item.section } : {}),
        strength: item.strength,
        ...(paths ? { scope: { paths } } : {}),
        sources: [source],
        similar: index.match(item.text),
        fingerprint,
      });
    }
  }
  return [...byPrint.values()];
}

// ---------------------------------------------------------------------------
// Tool settings
// ---------------------------------------------------------------------------

/** Linter rule names (or Ruff code prefixes) → catalog standard IDs. Lives with the catalog. */
export interface ToolMapping {
  eslint: Record<string, string>;
  biome: Record<string, string>;
  /** Exact Ruff codes, e.g. T201. Selections match by prefix (T20, T, ALL). */
  ruff: Record<string, string>;
  golangci: Record<string, string>;
  checkstyle: Record<string, string>;
  pmd: Record<string, string>;
  tsconfig: Record<string, string>;
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** JSON with comments and trailing commas (tsconfig, biome.jsonc, .eslintrc). */
function looseJson(text: string): unknown {
  try {
    return JSON.parse(
      text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
        .replace(/,(\s*[}\]])/g, "$1"),
    );
  } catch {
    return undefined;
  }
}

const STANCE: Record<string, ImportedToolSetting["stance"]> = {
  error: "enforced",
  "2": "enforced",
  warn: "warned",
  warning: "warned",
  "1": "warned",
  info: "warned",
  off: "disabled",
  "0": "disabled",
};

type Setting = ImportedToolSetting;

function eslintSettings(path: string, text: string, map: ToolMapping): Setting[] {
  const out: Setting[] = [];
  // Static text only: config files are never executed.
  const re =
    /["']?((?:@[\w-]+\/)?[\w-]+(?:\/[\w-]+)?)["']?\s*:\s*\[?\s*["']?(off|warn|error|0|1|2)\b["']?/g;
  for (const m of text.matchAll(re)) {
    const name = m[1] ?? "";
    const id = map.eslint[name];
    const value = m[2] ?? "";
    const stance = STANCE[value];
    if (id && stance)
      out.push({
        tool: "eslint",
        setting: name,
        value,
        stance,
        standardId: id,
        source: { file: path, line: lineAt(text, m.index ?? 0) },
      });
  }
  return out;
}

function biomeSettings(path: string, text: string, map: ToolMapping): Setting[] {
  const config = looseJson(text) as { linter?: { rules?: Record<string, unknown> } } | undefined;
  const out: Setting[] = [];
  for (const group of Object.values(config?.linter?.rules ?? {})) {
    if (!group || typeof group !== "object") continue;
    for (const [rule, raw] of Object.entries(group as Record<string, unknown>)) {
      const id = map.biome[rule];
      const value =
        typeof raw === "string" ? raw : ((raw as { level?: string } | null)?.level ?? "");
      const stance = STANCE[value];
      if (!id || !stance) continue;
      const index = text.search(new RegExp(`["']${rule}["']`));
      out.push({
        tool: "biome",
        setting: rule,
        value,
        stance,
        standardId: id,
        source: { file: path, ...(index >= 0 ? { line: lineAt(text, index) } : {}) },
      });
    }
  }
  return out;
}

/** Ruff's own defaults when a config doesn't set `select`. */
const RUFF_DEFAULT = ["E4", "E7", "E9", "F"];

function ruffSettings(path: string, text: string, map: ToolMapping): Setting[] {
  // In pyproject.toml, only the [tool.ruff...] tables count.
  let region = text;
  let base = 0;
  if (/pyproject\.toml$/.test(path)) {
    const start = text.search(/^\[tool\.ruff/m);
    if (start < 0) return [];
    const after = text.slice(start);
    const end = after.search(/^\[(?!tool\.ruff)/m);
    region = end > 0 ? after.slice(0, end) : after;
    base = start;
  }
  const list = (key: string) => {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(region);
    return m
      ? {
          codes: [...(m[1] ?? "").matchAll(/["']([A-Z]+[0-9]*)["']/g)].map((c) => c[1] ?? ""),
          line: lineAt(text, base + (m.index ?? 0)),
        }
      : undefined;
  };
  const select = list("select");
  const extend = list("extend-select");
  const ignore = list("ignore");
  const extendIgnore = list("extend-ignore");
  const selected = [...(select?.codes ?? RUFF_DEFAULT), ...(extend?.codes ?? [])];
  const ignored = [...(ignore?.codes ?? []), ...(extendIgnore?.codes ?? [])];
  const covers = (prefixes: string[], code: string) =>
    prefixes.some((p) => p === "ALL" || code.startsWith(p));
  const out: Setting[] = [];
  for (const [code, id] of Object.entries(map.ruff)) {
    const off = covers(ignored, code);
    const on = covers(selected, code);
    // Only what the configuration says, not every code Ruff could have checked.
    const explicit =
      covers([...(select?.codes ?? []), ...(extend?.codes ?? []), ...ignored], code) || on;
    if (!explicit || (!on && !off)) continue;
    const line = off
      ? (ignore ?? extendIgnore)?.line
      : (extend && covers(extend.codes, code) ? extend : select)?.line;
    out.push({
      tool: "ruff",
      setting: code,
      value: off ? "ignored" : select || extend ? "selected" : "default",
      stance: off ? "disabled" : "enforced",
      standardId: id,
      source: { file: path, ...(line ? { line } : {}) },
    });
  }
  return out;
}

function golangciSettings(path: string, text: string, map: ToolMapping): Setting[] {
  let config: { linters?: { enable?: unknown; disable?: unknown } } | undefined;
  try {
    config = parseYaml(text) as typeof config;
  } catch {
    return [];
  }
  const out: Setting[] = [];
  const add = (names: unknown, stance: Setting["stance"]) => {
    if (!Array.isArray(names)) return;
    for (const name of names.map(String)) {
      const id = map.golangci[name];
      if (!id) continue;
      const index = text.search(new RegExp(`^\\s*-\\s*${name}\\b`, "m"));
      out.push({
        tool: "golangci-lint",
        setting: name,
        value: stance === "disabled" ? "disabled" : "enabled",
        stance,
        standardId: id,
        source: { file: path, ...(index >= 0 ? { line: lineAt(text, index) } : {}) },
      });
    }
  };
  add(config?.linters?.enable, "enforced");
  add(config?.linters?.disable, "disabled");
  return out;
}

function xmlRuleSettings(
  tool: "checkstyle" | "pmd",
  path: string,
  text: string,
  table: Record<string, string>,
): Setting[] {
  const out: Setting[] = [];
  const re =
    tool === "checkstyle" ? /<module\s+name="(\w+)"/g : /<rule\s+ref="[^"]*?(?:\/|#)(\w+)"/g;
  for (const m of text.matchAll(re)) {
    const name = m[1] ?? "";
    const id = table[name];
    if (id)
      out.push({
        tool,
        setting: name,
        value: "enabled",
        stance: "enforced",
        standardId: id,
        source: { file: path, line: lineAt(text, m.index ?? 0) },
      });
  }
  return out;
}

function tsconfigSettings(path: string, text: string, map: ToolMapping): Setting[] {
  const options = ((looseJson(text) as { compilerOptions?: Record<string, unknown> } | undefined)
    ?.compilerOptions ?? {}) as Record<string, unknown>;
  const out: Setting[] = [];
  for (const [option, id] of Object.entries(map.tsconfig)) {
    if (typeof options[option] !== "boolean") continue;
    const index = text.search(new RegExp(`["']${option}["']`));
    out.push({
      tool: "typescript",
      setting: option,
      value: String(options[option]),
      stance: options[option] ? "enforced" : "disabled",
      standardId: id,
      source: { file: path, ...(index >= 0 ? { line: lineAt(text, index) } : {}) },
    });
  }
  return out;
}

const TOOL_FILES: [RegExp, (path: string, text: string, map: ToolMapping) => Setting[]][] = [
  [
    /(^|\/)(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/,
    eslintSettings,
  ],
  [/(^|\/)biome\.jsonc?$/, biomeSettings],
  [/(^|\/)(\.?ruff\.toml|pyproject\.toml)$/, ruffSettings],
  [/(^|\/)\.golangci\.ya?ml$/, golangciSettings],
  [/(^|\/)checkstyle[\w-]*\.xml$/, (p, t, m) => xmlRuleSettings("checkstyle", p, t, m.checkstyle)],
  [/(^|\/)(pmd[\w-]*|ruleset[\w-]*)\.xml$/, (p, t, m) => xmlRuleSettings("pmd", p, t, m.pmd)],
  [/^tsconfig\.json$/, tsconfigSettings],
];

const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.git)\//;

/** Settings that map to catalog rules, from the repository's own tool configurations. */
export async function importToolSettings(
  root: string,
  files: readonly string[],
  mapping: ToolMapping,
): Promise<ImportedToolSetting[]> {
  const out = new Map<string, Setting>();
  for (const path of files) {
    if (SKIP.test(path)) continue;
    const reader = TOOL_FILES.find(([re]) => re.test(path))?.[1];
    if (!reader) continue;
    const text = await readFile(join(root, path), "utf8").catch(() => "");
    if (text.length > 500_000) continue;
    for (const s of reader(path, text, mapping)) {
      // One entry per tool setting; the first (shallowest) file wins.
      const key = `${s.tool}:${s.setting}:${s.standardId}`;
      if (!out.has(key)) out.set(key, s);
    }
    if (out.size >= 300) break;
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// CODEOWNERS
// ---------------------------------------------------------------------------

/** Which kind of rule a path pattern is about, using the catalog's categories. */
const CATEGORY_HINTS: [RegExp, string][] = [
  [/(^|\/)\.github\/workflows|\.gitlab-ci|(^|\/)ci\//i, "ci"],
  [
    /(^|\/)(terraform|infra|infrastructure|k8s|kubernetes|helm|deploy|charts)(\/|$)|\.tf\b|dockerfile|docker-compose/i,
    "infrastructure",
  ],
  [/(^|\/)(security|auth|authn|authz|crypto|secrets?)(\/|$)/i, "security"],
  [/(^|\/)(tests?|spec|__tests__|e2e)(\/|$)|\.(test|spec)\./i, "testing"],
  [
    /package\.json|lock|requirements|go\.mod|go\.sum|pom\.xml|build\.gradle|dependabot|renovate/i,
    "supply-chain",
  ],
  [/(^|\/)(api|openapi|proto|graphql)(\/|$)|\.proto\b/i, "api-design"],
  [/(^|\/)(migrations?|db|database|schema)(\/|$)/i, "data"],
];

export async function importOwners(
  root: string,
  files: readonly string[],
): Promise<ImportedOwner[]> {
  const path = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"].find((p) =>
    files.includes(p),
  );
  if (!path) return [];
  const text = await readFile(join(root, path), "utf8").catch(() => "");
  const out: ImportedOwner[] = [];
  text.split("\n").forEach((line, i) => {
    const trimmed = line.replace(/\s#.*$/, "").trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) return;
    const [pattern, ...rest] = trimmed.split(/\s+/);
    const owners = rest
      .filter((o) => /^@[\w.-]+(\/[\w.-]+)?$|^[^@\s]+@[^@\s]+$/.test(o))
      .slice(0, 20);
    if (!pattern || owners.length === 0 || out.length >= 200) return;
    const category = CATEGORY_HINTS.find(([re]) => re.test(pattern))?.[1];
    out.push({
      pattern: pattern.slice(0, 300),
      owners,
      ...(category ? { category } : {}),
      repositoryDefault: pattern === "*" || pattern === "/*" || pattern === "**",
      source: { file: path, startLine: i + 1 },
    });
  });
  return out;
}
