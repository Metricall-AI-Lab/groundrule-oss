import { renderTargets, syncOutputs } from "@groundrule/adapters";
import {
  appliesToRepository,
  effectiveStandards,
  gitRoot,
  inspectRepository,
} from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import { EXIT, type IO, println, style } from "../io.js";
import { openWorkspace } from "../workspace.js";

export async function doctor(io: IO): Promise<number> {
  const s = style(io);
  let problems = 0;
  const ok = (msg: string) => println(io, `   ${s.green("✓")} ${msg}`);
  const warn = (msg: string, hint?: string) => {
    println(io, `   ${s.yellow("!")} ${msg}${hint ? `\n     ${s.dim(hint)}` : ""}`);
  };
  const fail = (msg: string, hint?: string) => {
    problems++;
    println(io, `   ${s.red("✕")} ${msg}${hint ? `\n     ${s.dim(hint)}` : ""}`);
  };

  println(io);
  println(io, ` ${s.bold("groundrule doctor")}`);
  println(io);

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`Node.js ${process.versions.node}`);
  else fail(`Node.js ${process.versions.node} is too old`, "Groundrule needs Node.js 22 or newer.");

  if (await gitRoot(io.cwd)) ok("Inside a git repository");
  else
    warn(
      "Not a git repository",
      "`groundrule check` will audit every file instead of your changes.",
    );

  const workspace = await openWorkspace(io, { use: "agents" });
  if (!workspace) {
    fail("Configuration has errors (see above)");
    println(io);
    return EXIT.failed;
  }
  if (workspace.platform) {
    const { org, target } = workspace.platform.rulebook;
    ok(
      `Connected to ${org.name} on ${workspace.platform.url}${target.repository ? ` as ${target.repository.name}` : ""}`,
    );
  }
  const repo = await inspectRepository(workspace);
  const effective = effectiveStandards(workspace).filter((l) =>
    appliesToRepository(l.standard, repo),
  );
  ok(
    `Configuration is valid: ${effective.length} of ${workspace.standards.length} standards apply to this repository`,
  );
  if (workspace.diagnostics.length)
    warn(`${workspace.diagnostics.length} configuration warning(s) (see above)`);

  const registry = new Map(builtinEvaluators.map((e) => [e.id, e]));
  const used = new Set(effective.flatMap((l) => l.standard.spec.checks.map((c) => c.evaluator)));
  for (const id of [...used].sort()) {
    const evaluator = registry.get(id);
    if (!evaluator) {
      fail(`Unknown evaluator "${id}"`);
      continue;
    }
    const support = evaluator.supports
      ? await evaluator.supports({
          root: repo.root,
          languages: repo.languages,
          frameworks: repo.frameworks,
          tags: repo.tags,
          files: [],
          targetFiles: [],
          changes: [],
          readFile: async () => "",
          signal: new AbortController().signal,
          log: () => {},
        })
      : true;
    if (support === true) ok(`Evaluator ${id} is ready`);
    else warn(`Evaluator ${id} is unavailable`, support);
  }

  const outputs = renderTargets({
    standards: effective.map((l) => l.standard),
    targets: workspace.config.targets,
  });
  const stale = (
    await syncOutputs(workspace.root, outputs, { dryRun: true, targets: workspace.config.targets })
  ).filter((c) => c.status !== "unchanged");
  if (stale.length === 0)
    ok(`Agent instructions are up to date (${workspace.config.targets.join(", ")})`);
  else
    fail(
      `Agent instructions are out of date: ${stale.map((c) => c.path).join(", ")}`,
      "Run `groundrule sync`.",
    );

  println(io);
  println(
    io,
    problems
      ? ` ${s.red(`${problems} problem(s) found.`)}`
      : ` ${s.green("Everything looks good.")}`,
  );
  println(io);
  return problems ? EXIT.failed : EXIT.ok;
}
