import type { ChangedFile, EvalContext, Evaluator } from "@groundrule/core";
import { API_VERSION, Standard } from "@groundrule/spec";

export function fakeContext(
  files: Record<string, string>,
  extra: Partial<EvalContext> = {},
): EvalContext {
  const paths = Object.keys(files).sort();
  return {
    root: "/repo",
    languages: [],
    frameworks: [],
    tags: [],
    files: paths,
    targetFiles: paths,
    readFile: async (p) => {
      const text = files[p];
      if (text === undefined) throw new Error(`ENOENT ${p}`);
      return text;
    },
    signal: new AbortController().signal,
    log: () => {},
    ...extra,
  };
}

export const standard = Standard.parse({
  apiVersion: API_VERSION,
  kind: "Standard",
  metadata: { id: "TEST-001", title: "Test", type: "requirement" },
  spec: { severity: "warning", requirement: "Test requirement." },
});

/** Validate options the way the runner does, then evaluate. */
export async function run<O>(
  evaluator: Evaluator<O>,
  options: Record<string, unknown>,
  context: EvalContext,
) {
  const parsed = evaluator.optionsSchema.parse(options);
  return evaluator.evaluate({
    standard,
    check: { evaluator: evaluator.id, ...options },
    options: parsed,
    standardDir: "/repo/.groundrule/standards",
    context,
  });
}

export function change(
  path: string,
  status: ChangedFile["status"] = "modified",
  lines: Array<[number, number]> = [[1, 1]],
): ChangedFile {
  return { path, status, changedLines: lines.map(([start, end]) => ({ start, end })) };
}
