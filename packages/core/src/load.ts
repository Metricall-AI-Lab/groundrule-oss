import { readFile } from "node:fs/promises";
import { DOCUMENT_SCHEMAS, type DocumentKind, GroundruleDocument } from "@groundrule/spec";
import { type Document, isMap, isNode, LineCounter, parseDocument as parseYaml } from "yaml";
import type { z } from "zod";
import { type Diagnostic, formatPath } from "./diagnostics.js";

export type LoadResult<T = GroundruleDocument> =
  | { ok: true; file: string; document: T }
  | { ok: false; file: string; diagnostics: Diagnostic[] };

type KindToDocument<K extends DocumentKind> = Extract<GroundruleDocument, { kind: K }>;

/**
 * Parse and validate one Groundrule YAML document.
 * Never throws for bad input: every problem is returned as a located diagnostic.
 */
export function parseDocument(text: string, file: string): LoadResult;
export function parseDocument<K extends DocumentKind>(
  text: string,
  file: string,
  expectedKind: K,
): LoadResult<KindToDocument<K>>;
export function parseDocument(text: string, file: string, expectedKind?: DocumentKind): LoadResult {
  const lineCounter = new LineCounter();
  const yamlDoc = parseYaml(text, { lineCounter, prettyErrors: false, uniqueKeys: true });

  const syntaxErrors = [...yamlDoc.errors, ...yamlDoc.warnings];
  if (yamlDoc.errors.length > 0) {
    return {
      ok: false,
      file,
      diagnostics: syntaxErrors.map((e) => {
        const pos = e.linePos?.[0] ?? lineCounter.linePos(e.pos[0]);
        return {
          severity: yamlDoc.errors.includes(e) ? "error" : "warning",
          file,
          ...(pos ? { line: pos.line, column: pos.col } : {}),
          message: e.message.split("\n")[0] ?? e.message,
        } satisfies Diagnostic;
      }),
    };
  }

  const data: unknown = yamlDoc.toJS();
  if (data === null || data === undefined) {
    return {
      ok: false,
      file,
      diagnostics: [{ severity: "error", file, message: "File is empty." }],
    };
  }
  if (!isMap(yamlDoc.contents)) {
    return {
      ok: false,
      file,
      diagnostics: [
        {
          severity: "error",
          file,
          line: 1,
          column: 1,
          message: "Expected a YAML mapping (key: value).",
        },
      ],
    };
  }

  const kind = (data as { kind?: unknown }).kind;
  if (expectedKind && kind !== expectedKind) {
    return {
      ok: false,
      file,
      diagnostics: [
        {
          severity: "error",
          file,
          ...locate(yamlDoc, lineCounter, ["kind"]),
          path: "kind",
          message: `Expected kind "${expectedKind}", found ${kind === undefined ? "none" : JSON.stringify(kind)}.`,
        },
      ],
    };
  }

  const schema: z.ZodType =
    typeof kind === "string" && kind in DOCUMENT_SCHEMAS
      ? DOCUMENT_SCHEMAS[kind as DocumentKind]
      : GroundruleDocument;
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, file, document: result.data as GroundruleDocument };
  }

  return {
    ok: false,
    file,
    diagnostics: result.error.issues.map((issue) => {
      // Unknown keys are reported on the parent; point at the first offending key instead.
      const path =
        issue.code === "unrecognized_keys" && issue.keys[0] !== undefined
          ? [...issue.path, issue.keys[0]]
          : issue.path;
      return {
        severity: "error",
        file,
        ...locate(yamlDoc, lineCounter, path),
        ...(issue.path.length > 0 || path.length > 0 ? { path: formatPath(path) } : {}),
        message: issue.message,
      } satisfies Diagnostic;
    }),
  };
}

/** Read a file from disk and parse it. I/O failures become diagnostics too. */
export async function loadFile(file: string): Promise<LoadResult>;
export async function loadFile<K extends DocumentKind>(
  file: string,
  expectedKind: K,
): Promise<LoadResult<KindToDocument<K>>>;
export async function loadFile(file: string, expectedKind?: DocumentKind): Promise<LoadResult> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      file,
      diagnostics: [{ severity: "error", file, message: `Cannot read file: ${reason}` }],
    };
  }
  return expectedKind ? parseDocument(text, file, expectedKind) : parseDocument(text, file);
}

/** Find the closest existing YAML node for a path and return its position. */
function locate(
  doc: Document,
  lineCounter: LineCounter,
  path: ReadonlyArray<PropertyKey>,
): { line?: number; column?: number } {
  for (let depth = path.length; depth >= 0; depth--) {
    const segment = path.slice(0, depth).filter((p): p is string | number => typeof p !== "symbol");
    const node = segment.length === 0 ? doc.contents : doc.getIn(segment, true);
    if (isNode(node) && node.range) {
      // For a missing or unknown key, prefer the key's own position over its value.
      const keyNode = depth === path.length ? findKeyNode(doc, segment) : undefined;
      const offset = keyNode?.range?.[0] ?? node.range[0];
      const pos = lineCounter.linePos(offset);
      return { line: pos.line, column: pos.col };
    }
  }
  return {};
}

function findKeyNode(doc: Document, path: ReadonlyArray<string | number>) {
  if (path.length === 0) return undefined;
  const parent = path.length === 1 ? doc.contents : doc.getIn(path.slice(0, -1), true);
  if (!isMap(parent)) return undefined;
  const last = path[path.length - 1];
  const pair = parent.items.find(
    (item) => isNode(item.key) && (item.key as { value?: unknown }).value === last,
  );
  return pair && isNode(pair.key) ? pair.key : undefined;
}
