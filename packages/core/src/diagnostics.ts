/** A problem found while loading or validating a Groundrule file. */
export interface Diagnostic {
  severity: "error" | "warning";
  file: string;
  /** 1-based line, when the problem can be located in the source. */
  line?: number;
  /** 1-based column, when the problem can be located in the source. */
  column?: number;
  /** Dotted path to the offending field, e.g. spec.checks[0].evaluator. */
  path?: string;
  message: string;
}

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out ? `.${String(key)}` : String(key);
  }
  return out;
}

/** file:line:column  path  message — the format editors and terminals link on. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.file, d.line, d.column].filter((v) => v !== undefined).join(":");
  return d.path ? `${where}  ${d.path}: ${d.message}` : `${where}  ${d.message}`;
}
