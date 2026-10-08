import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { defineEvaluator, type EvaluatorFinding } from "@groundrule/core";
import { z } from "zod";
import { truncate } from "./util.js";

const exec = promisify(execFile);

const Options = z.strictObject({
  /** Path to a Semgrep rules file, relative to the standard's file. Or a registry config like p/owasp-top-ten. */
  rules: z.string().min(1),
  timeoutSeconds: z.number().int().positive().max(1800).default(300),
});

let available: Promise<true | string> | undefined;

/** Overridable for tests. */
export const semgrepRuntime = {
  binary: "semgrep",
  run: async (args: string[], cwd: string, timeoutMs: number) =>
    (
      await exec(semgrepRuntime.binary, args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 256 * 1024 * 1024,
      })
    ).stdout,
  resetAvailability() {
    available = undefined;
  },
};

interface SemgrepOutput {
  results?: Array<{
    check_id: string;
    path: string;
    start: { line: number };
    end: { line: number };
    extra?: { message?: string; lines?: string; severity?: string };
  }>;
  errors?: Array<{ message?: string; level?: string }>;
}

export const semgrepEvaluator = defineEvaluator({
  id: "semgrep",
  source: "static-analysis",
  description: "Run Semgrep rules and report matches.",
  optionsSchema: Options,
  supports() {
    available ??= exec(semgrepRuntime.binary, ["--version"], { timeout: 30_000 }).then(
      () => true as const,
      () =>
        "Semgrep is not installed. Install it with `brew install semgrep` or `pipx install semgrep`.",
    );
    return available;
  },
  async evaluate({ options, context, standardDir }) {
    if (context.targetFiles.length === 0) return [];
    const isRegistry = /^(p|r|s)\//.test(options.rules) || options.rules === "auto";
    const config = isRegistry
      ? options.rules
      : isAbsolute(options.rules)
        ? options.rules
        : resolve(standardDir, options.rules);
    if (!isRegistry) {
      await access(config).catch(() => {
        throw new Error(`Semgrep rules not found at ${config}`);
      });
    }

    const findings: EvaluatorFinding[] = [];
    // Keep command lines well under OS limits.
    for (let i = 0; i < context.targetFiles.length; i += 400) {
      const batch = context.targetFiles.slice(i, i + 400);
      const stdout = await semgrepRuntime.run(
        [
          "scan",
          "--json",
          "--quiet",
          "--metrics=off",
          "--disable-version-check",
          "--config",
          config,
          "--",
          ...batch,
        ],
        context.root,
        options.timeoutSeconds * 1000,
      );
      const output = JSON.parse(stdout) as SemgrepOutput;
      const fatal = output.errors?.filter((e) => e.level === "error") ?? [];
      if (fatal.length > 0 && !output.results?.length) {
        throw new Error(fatal.map((e) => e.message ?? "unknown error").join("; "));
      }
      const fileLines = new Map<string, string[]>();
      for (const result of output.results ?? []) {
        // Semgrep redacts `extra.lines` ("requires login") when not logged in, so read the code ourselves.
        let lines = fileLines.get(result.path);
        if (!lines) {
          lines = (await context.readFile(result.path).catch(() => "")).split("\n");
          fileLines.set(result.path, lines);
        }
        const fromFile = lines
          .slice(result.start.line - 1, result.end.line)
          .join("\n")
          .trim();
        const reported = result.extra?.lines?.trim() ?? "";
        const snippet = fromFile || (reported === "requires login" ? "" : reported);
        findings.push({
          status: "violation",
          confidence: "high",
          message: result.extra?.message?.trim() || `Matched Semgrep rule ${result.check_id}`,
          location: {
            file: result.path,
            startLine: result.start.line,
            ...(result.end.line !== result.start.line ? { endLine: result.end.line } : {}),
          },
          evidence: [
            `Semgrep rule ${result.check_id}`,
            ...(snippet ? [`${result.start.line}: ${truncate(snippet.split("\n")[0] ?? "")}`] : []),
          ],
          snippet: `${result.check_id}:${snippet || `${result.path}:${result.start.line}`}`,
        });
      }
    }
    return findings;
  },
});
