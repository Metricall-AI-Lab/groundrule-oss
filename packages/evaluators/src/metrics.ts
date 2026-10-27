// `metrics`: size and complexity limits (ADR 0013). A file's line count, and per function its
// lines, its parameters and how deeply its body nests, for TypeScript, JavaScript, Python,
// Java, Kotlin and Go. Functions are found with tolerant patterns over text with comments
// and strings blanked, so the measurements are reported as `high`, not certain; the file's
// line count is certain.
import {
  defineEvaluator,
  type EvaluatorFinding,
  isGoFile,
  isJavaFile,
  isJsFile,
  isPyFile,
} from "@groundrule/core";
import picomatch from "picomatch";
import { z } from "zod";
import { Globs, readText, truncate } from "./util.js";

const Limit = z.number().int().positive().max(100_000);
const Options = z
  .strictObject({
    /** Files the rule applies to. Default: every file in the standard's scope. */
    from: Globs.optional(),
    /** Files in `from` the rule skips, e.g. generated code. */
    exclude: Globs.optional(),
    maxFileLines: Limit.optional(),
    maxFunctionLines: Limit.optional(),
    maxParameters: z.number().int().nonnegative().max(1000).optional(),
    maxNesting: z.number().int().nonnegative().max(100).optional(),
    message: z.string().min(1).optional(),
    remediation: z.string().min(1).optional(),
  })
  .refine(
    (o) =>
      o.maxFileLines !== undefined ||
      o.maxFunctionLines !== undefined ||
      o.maxParameters !== undefined ||
      o.maxNesting !== undefined,
    {
      message:
        "Set at least one limit: maxFileLines, maxFunctionLines, maxParameters or maxNesting.",
    },
  );
type MetricsOptions = z.infer<typeof Options>;

export interface MeasuredFunction {
  name: string;
  line: number;
  lines: number;
  parameters: number;
  nesting: number;
}

/** Comments and string contents blanked to spaces; line structure kept. */
function blank(text: string, lineComment: string | null = "//"): string {
  const out = text.split("");
  const n = text.length;
  let i = 0;
  const wipe = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = text[i] as string;
    const next = text[i + 1];
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      wipe(i, stop);
      i = stop;
      continue;
    }
    if (lineComment && text.startsWith(lineComment, i)) {
      let end = text.indexOf("\n", i);
      if (end < 0) end = n;
      wipe(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // Python triple quotes and Kotlin raw strings span lines; other strings end at the line.
      const triple = text.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text.startsWith(quote, j)) break;
        if (!triple && c !== "`" && text[j] === "\n") break;
        j++;
      }
      const stop = Math.min(n, j + quote.length);
      wipe(i + quote.length, Math.min(j, n));
      i = stop;
      continue;
    }
    i++;
  }
  return out.join("");
}

const lineOf = (text: string, offset: number) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

/** Parameters in a header's parenthesised list: commas at depth zero, ignoring empties. */
function countParameters(params: string, python = false): number {
  let depth = 0;
  let count = 0;
  let current = "";
  const flush = () => {
    const p = current.trim();
    current = "";
    if (!p) return;
    if (python && (p === "self" || p === "cls" || p === "*" || p === "/")) return;
    count++;
  };
  for (const ch of params) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) flush();
    else current += ch;
  }
  flush();
  return count;
}

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "else",
  "do",
  "try",
  "with",
  "when",
  "synchronized",
  "new",
  "throw",
  "await",
  "yield",
  "typeof",
  "select",
  "case",
  "defer",
  "go",
  "super",
  "this",
]);

/** Brace-language functions: a header, then the body between its `{` and the matching `}`. */
function braceFunctions(text: string, headers: RegExp[]): MeasuredFunction[] {
  const code = blank(text);
  const out: MeasuredFunction[] = [];
  const seen = new Set<number>();
  for (const re of headers) {
    for (const m of code.matchAll(re)) {
      const name = m.groups?.name ?? "";
      if (!name || KEYWORDS.has(name)) continue;
      const open = code.indexOf("{", m.index + m[0].length - 1);
      if (open < 0 || seen.has(open)) continue;
      // The `{` must follow the header closely: on the same line or the next.
      const between = code.slice(m.index + m[0].length - 1, open);
      if (between.split("\n").length > 2) continue;
      seen.add(open);
      let depth = 0;
      let max = 0;
      let close = -1;
      for (let i = open; i < code.length; i++) {
        const ch = code[i];
        if (ch === "{") {
          depth++;
          if (depth > max) max = depth;
        } else if (ch === "}") {
          depth--;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      if (close < 0) continue;
      const line = lineOf(code, m.index);
      out.push({
        name,
        line,
        lines: lineOf(code, close) - line + 1,
        parameters: countParameters(m.groups?.params ?? ""),
        nesting: Math.max(0, max - 1),
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

const JS_HEADERS = [
  /(?<![\w$.])(?:async\s+)?function\s*\*?\s*(?<name>[\w$]+)\s*(?:<[^>]*>)?\s*\((?<params>[^)]*)\)[^{;]*\{/g,
  /(?<![\w$.])(?:const|let|var)\s+(?<name>[\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\((?<params>[^)]*)\)|(?<single>[\w$]+))\s*(?::[^=]*)?=>\s*\{/g,
  /^[ \t]*(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*(?<name>[\w$]+)\s*(?:<[^>]*>)?\s*\((?<params>[^)]*)\)\s*(?::[^{;=]*)?\{/gm,
];
const JAVA_HEADERS = [
  /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|override|open|internal|suspend|inline|operator|infix)\s+)*(?:[\w$<>[\],?.]+\s+)?(?<name>[\w$]+)\s*\((?<params>[^)]*)\)\s*(?:throws\s+[\w$.,\s]+)?\{/gm,
  /(?<![\w$.])fun\s+(?:<[^>]*>\s*)?(?:[\w$<>.?]+\.)?(?<name>[\w$]+)\s*\((?<params>[^)]*)\)\s*(?::\s*[^{=]+)?\{/g,
];
const GO_HEADERS = [
  /^func\s+(?:\([^)]*\)\s*)?(?<name>\w+)\s*(?:\[[^\]]*\]\s*)?\((?<params>[^)]*)\)[^{]*\{/gm,
];

/** Python functions: `def` to the end of the indented body. */
function pythonFunctions(text: string): MeasuredFunction[] {
  const code = blank(text, "#");
  const lines = code.split("\n");
  const out: MeasuredFunction[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(?<indent>[ \t]*)(?:async\s+)?def\s+(?<name>\w+)\s*\(/.exec(lines[i] as string);
    if (!head) continue;
    const indent = head.groups?.indent?.length ?? 0;
    // The parameter list may span lines: read to the closing parenthesis.
    let params = "";
    let depth = 0;
    let j = i;
    let started = false;
    outer: for (; j < lines.length; j++) {
      const l = lines[j] as string;
      for (let k = j === i ? l.indexOf("(") : 0; k < l.length; k++) {
        const ch = l[k];
        if (ch === "(") {
          depth++;
          if (!started) {
            started = true;
            continue;
          }
        } else if (ch === ")") {
          depth--;
          if (depth === 0) break outer;
        }
        if (started) params += ch;
      }
      params += " ";
    }
    // Body: lines indented deeper than the def, until one that is not (blank lines pass).
    let last = j;
    let bodyIndent = -1;
    let maxExtra = 0;
    for (let k = j + 1; k < lines.length; k++) {
      const l = lines[k] as string;
      if (!l.trim()) continue;
      const ind = l.length - l.trimStart().length;
      if (ind <= indent) break;
      last = k;
      if (bodyIndent < 0) bodyIndent = ind;
      else if (ind > bodyIndent) maxExtra = Math.max(maxExtra, ind - bodyIndent);
    }
    const unit = bodyIndent > indent ? bodyIndent - indent : 4;
    out.push({
      name: head.groups?.name ?? "",
      line: i + 1,
      lines: last - i + 1,
      parameters: countParameters(params, true),
      nesting: Math.round(maxExtra / unit),
    });
  }
  return out;
}

/** The functions of a file, by language; nothing for other files. */
export function measureFunctions(file: string, text: string): MeasuredFunction[] {
  if (isJsFile(file)) return braceFunctions(text, JS_HEADERS);
  if (isPyFile(file)) return pythonFunctions(text);
  if (isJavaFile(file)) return braceFunctions(text, JAVA_HEADERS);
  if (isGoFile(file)) return braceFunctions(text, GO_HEADERS);
  return [];
}

export const metricsEvaluator = defineEvaluator({
  id: "metrics",
  source: "deterministic",
  description:
    "Size and complexity limits: lines per file, lines per function, parameters per function, and how deeply a function nests. TypeScript, JavaScript, Python, Java, Kotlin and Go.",
  optionsSchema: Options as unknown as z.ZodType<MetricsOptions>,
  async evaluate({ options, context }) {
    const from = options.from ? picomatch(options.from, { dot: true }) : () => true;
    const skip = options.exclude ? picomatch(options.exclude, { dot: true }) : () => false;
    const findings: EvaluatorFinding[] = [];
    const push = (
      file: string,
      line: number,
      confidence: "certain" | "high",
      message: string,
      evidence: string,
      snippet: string,
    ) =>
      findings.push({
        status: "violation",
        confidence,
        message: options.message ?? message,
        location: { file, startLine: line },
        evidence: [evidence],
        ...(options.remediation ? { remediation: options.remediation } : {}),
        snippet: truncate(snippet),
      });
    for (const file of context.targetFiles) {
      if (!from(file) || skip(file)) continue;
      const text = await readText(context.readFile, file);
      if (text === undefined) continue;
      const lines = text.split("\n");
      const count = text.endsWith("\n") ? lines.length - 1 : lines.length;
      if (options.maxFileLines !== undefined && count > options.maxFileLines)
        push(
          file,
          1,
          "certain",
          `${file} is ${count} lines, over the limit of ${options.maxFileLines}`,
          `${file} has ${count} lines; the limit is ${options.maxFileLines}`,
          lines[0] ?? "",
        );
      const wantsFunctions =
        options.maxFunctionLines !== undefined ||
        options.maxParameters !== undefined ||
        options.maxNesting !== undefined;
      if (!wantsFunctions) continue;
      for (const fn of measureFunctions(file, text)) {
        const header = lines[fn.line - 1] ?? "";
        if (options.maxFunctionLines !== undefined && fn.lines > options.maxFunctionLines)
          push(
            file,
            fn.line,
            "high",
            `${fn.name}() in ${file} is ${fn.lines} lines, over the limit of ${options.maxFunctionLines}`,
            `${file}:${fn.line} ${fn.name}() spans ${fn.lines} lines; the limit is ${options.maxFunctionLines}`,
            header,
          );
        if (options.maxParameters !== undefined && fn.parameters > options.maxParameters)
          push(
            file,
            fn.line,
            "high",
            `${fn.name}() in ${file} takes ${fn.parameters} parameters, over the limit of ${options.maxParameters}`,
            `${file}:${fn.line} ${fn.name}() declares ${fn.parameters} parameters; the limit is ${options.maxParameters}`,
            header,
          );
        if (options.maxNesting !== undefined && fn.nesting > options.maxNesting)
          push(
            file,
            fn.line,
            "high",
            `${fn.name}() in ${file} nests ${fn.nesting} levels deep, over the limit of ${options.maxNesting}`,
            `${file}:${fn.line} ${fn.name}() nests ${fn.nesting} levels; the limit is ${options.maxNesting}`,
            header,
          );
      }
    }
    return findings;
  },
});
