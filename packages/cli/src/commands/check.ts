import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GitError, runChecks } from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import {
  colorEnabled,
  type Format,
  renderJson,
  renderMarkdown,
  renderSarif,
  renderTerminal,
} from "@groundrule/reporters";
import { EXIT, eprintln, type IO, println, VERSION } from "../io.js";
import { openWorkspace, printDiagnostics } from "../workspace.js";

export interface CheckOptions {
  base?: string;
  all?: boolean;
  format: Format;
  output?: string;
  /** Also append a Markdown summary to this file (e.g. $GITHUB_STEP_SUMMARY). */
  summary?: string;
  failOn?: "blocker" | "warning" | "none";
  verbose?: boolean;
  only?: string[];
}

export async function check(io: IO, options: CheckOptions): Promise<number> {
  // From the platform: Enforce rules as set, Advise rules as warnings, Teach rules not checked.
  const workspace = await openWorkspace(io, { use: "checks" });
  if (!workspace) return EXIT.usage;
  if (options.failOn) workspace.config.enforcement.failOn = options.failOn;

  let result: Awaited<ReturnType<typeof runChecks>>;
  try {
    result = await runChecks({
      workspace,
      evaluators: builtinEvaluators,
      ...(options.all
        ? { mode: "all" as const }
        : options.base
          ? { mode: "changes" as const }
          : {}),
      ...(options.base ? { base: options.base } : {}),
      ...(options.only?.length ? { only: options.only } : {}),
    });
  } catch (error) {
    if (error instanceof GitError) {
      eprintln(io, `✕ ${error.message}`);
      return EXIT.usage;
    }
    throw error;
  }

  const input = { result, standards: workspace.standards, version: VERSION };
  if (options.format === "terminal") {
    // Diagnostics from the run are part of the terminal report.
    io.stdout.write(
      renderTerminal(input, {
        color: colorEnabled(io.stdout, io.env),
        verbose: options.verbose ?? false,
      }),
    );
  } else {
    printDiagnostics(io, result.diagnostics, workspace.root);
    const render = { json: renderJson, sarif: renderSarif, markdown: renderMarkdown }[
      options.format
    ];
    const text = render(input);
    if (options.output) {
      await writeFile(resolve(io.cwd, options.output), text);
      println(
        io,
        `Wrote ${options.format} report to ${options.output} (${result.failed ? "failed" : "passed"}).`,
      );
    } else io.stdout.write(text);
  }

  if (options.summary) await appendFile(resolve(io.cwd, options.summary), renderMarkdown(input));

  if (result.diagnostics.some((d) => d.severity === "error")) return EXIT.usage;
  return result.failed ? EXIT.failed : EXIT.ok;
}
