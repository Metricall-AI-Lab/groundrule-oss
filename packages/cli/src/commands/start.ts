// `groundrule start`, and what `groundrule` alone does in a repository with no configuration:
// a first look at what the rules find here today, then one question, then everything set up.
// The look comes first and writes nothing, so a team sees a real result before it commits to
// anything.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  exists,
  findConfig,
  loadWorkspace,
  type RunResult,
  runChecks,
  type Workspace,
} from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import { resolvePack } from "@groundrule/packs";
import { colorEnabled, renderTerminal } from "@groundrule/reporters";
import { EXIT, eprintln, type IO, println, style, VERSION } from "../io.js";
import { printDiagnostics } from "../workspace.js";
import { hooks } from "./hooks.js";
import { type InitPlan, planInit, targetOutputs, writeInit } from "./init.js";
import { sync } from "./sync.js";

export interface StartOptions {
  /** Set the repository up without asking. */
  yes?: boolean;
  /** Leave the agent hooks out. */
  hooks?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The workspace `init` would create, loaded without touching the repository: the planned config
 * is written to a temporary folder, read with the normal loader, and pointed back at the real
 * root.
 */
async function plannedWorkspace(io: IO, plan: InitPlan): Promise<Workspace | undefined> {
  const tmp = await mkdtemp(join(tmpdir(), "groundrule-start-"));
  try {
    await mkdir(join(tmp, CONFIG_DIR), { recursive: true });
    await writeFile(join(tmp, CONFIG_DIR, CONFIG_FILE), plan.config);
    const loaded = await loadWorkspace({ cwd: tmp, resolveRegistry: resolvePack });
    if (!loaded.ok) {
      printDiagnostics(io, loaded.diagnostics, tmp);
      return undefined;
    }
    return { ...loaded.workspace, root: plan.root, configFile: plan.configFile };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** A yes-or-no answer from a person at a terminal; undefined when nobody is there to ask. */
async function confirm(io: IO, question: string): Promise<boolean | undefined> {
  const stdin = io.stdin as (AsyncIterable<string | Uint8Array> & { isTTY?: boolean }) | undefined;
  if (!stdin?.isTTY || !io.stdout.isTTY) return undefined;
  io.stdout.write(question);
  for await (const chunk of stdin) {
    const answer = (typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
      .trim()
      .toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  }
  return false;
}

function counts(result: RunResult) {
  const guidance = result.outcomes.filter((o) => o.status === "guidance").length;
  const skipped = result.outcomes.filter((o) => o.status === "skipped").length;
  const withFindings = new Set(
    result.findings
      .filter((f) => f.status !== "not-evaluable" && !f.suppressedBy)
      .map((f) => f.standardId),
  ).size;
  const findings = result.findings.filter(
    (f) => f.status !== "not-evaluable" && !f.suppressedBy,
  ).length;
  return {
    checked: result.outcomes.length - guidance - skipped,
    guidance,
    findings,
    withFindings,
  };
}

export async function start(io: IO, options: StartOptions = {}): Promise<number> {
  const s = style(io);
  // planInit refuses an existing config with an error meant for `init`; say it our way first.
  const existing = await findConfig(io.cwd);
  const plan = existing ? EXIT.usage : await planInit(io, {});
  if (typeof plan === "number") {
    println(io);
    println(
      io,
      ` This repository is already set up. ${s.bold("groundrule check")} checks your changes; ${s.bold("groundrule doctor")} says if anything is off.`,
    );
    println(io);
    return EXIT.ok;
  }
  const workspace = await plannedWorkspace(io, plan);
  if (!workspace) return EXIT.usage;

  let result: RunResult;
  try {
    result = await runChecks({ workspace, evaluators: builtinEvaluators, mode: "all" });
  } catch (error) {
    eprintln(io, `✕ ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.usage;
  }
  const c = counts(result);

  println(io);
  println(io, ` ${s.bold("groundrule")} ${s.dim(`· a first look at ${basename(plan.root)}`)}`);
  println(io);
  if (plan.languages.length)
    println(io, `   ${s.dim("Stack")}   ${plan.languages.slice(0, 4).join(", ")}`);
  println(
    io,
    `   ${s.dim("Rules")}   ${result.outcomes.length} from ${plan.packs.join(", ") || "no packs"}`,
  );
  println(
    io,
    `           ${plural(c.checked, "is", "are")} checked on every change · ${plural(c.guidance, "is an instruction", "are instructions")} for your coding agents, not checked`,
  );
  println(io);
  if (c.findings) {
    println(io, ` ${s.bold("What the checks find in this repository today")}`);
    println(io);
    io.stdout.write(
      renderTerminal(
        { result, standards: workspace.standards, version: VERSION },
        { color: colorEnabled(io.stdout, io.env), findingsOnly: true },
      ),
    );
    println(io);
    println(
      io,
      ` ${plural(c.findings, "finding")} in ${plural(c.withFindings, "rule")}. This is code that already exists: it is listed, and it never blocks.`,
    );
  } else {
    println(io, ` ${s.green("✓")} The checks find nothing in this repository today.`);
  }
  println(io, " Once set up, only what a change introduces is checked.");
  println(io);

  const wantHooks = options.hooks !== false;
  const files = [
    [`${CONFIG_DIR}/${CONFIG_FILE}`, "the rules this repository follows"],
    [targetOutputs(plan.targets).join(", "), "the same rules, for your coding agents"],
    ...(wantHooks
      ? [[".claude/settings.json", "hooks: the check runs when the agent finishes a task"]]
      : []),
  ] as [string, string][];
  const width = Math.max(...files.map(([f]) => f.length));
  println(io, ` ${s.bold("Set this repository up?")} It writes:`);
  for (const [file, what] of files) println(io, `   ${file.padEnd(width)}  ${s.dim(what)}`);
  println(io);

  let go = options.yes ? true : await confirm(io, " Set it up now? [Y/n] ");
  if (go === undefined) {
    println(
      io,
      ` Nothing was written. To set it up, run ${s.bold("groundrule start --yes")}${wantHooks ? ` ${s.dim("(add --no-hooks to leave the hooks out)")}` : ""}.`,
    );
    println(io);
    return EXIT.ok;
  }
  if (!go) {
    println(io);
    println(io, ` Nothing was written. Run ${s.bold("groundrule start")} again whenever you like.`);
    println(io);
    return EXIT.ok;
  }
  // A config that appeared while the question was open is someone else's; leave it alone.
  if (await exists(plan.configFile)) go = false;
  if (!go) {
    eprintln(io, `✕ ${CONFIG_DIR}/${CONFIG_FILE} appeared meanwhile, so nothing was changed.`);
    return EXIT.usage;
  }

  const silent: IO = { ...io, cwd: plan.root, stdout: { write() {} } };
  await writeInit(plan);
  if ((await sync(silent, {})) !== EXIT.ok) {
    eprintln(io, "✕ The agent files could not be written. Run `groundrule sync` to see why.");
    return EXIT.usage;
  }
  const hooked = wantHooks ? (await hooks(silent, {})) === EXIT.ok : false;

  if (!options.yes) println(io);
  println(
    io,
    ` ${s.green("✓")} Set up. Commit these files so your whole team gets the same rules:`,
  );
  println(
    io,
    `   ${[`${CONFIG_DIR}/`, ...targetOutputs(plan.targets), ...(hooked ? [".claude/settings.json"] : [])].join("  ")}`,
  );
  println(io);
  println(io, ` ${s.bold("Next")}`);
  println(io, `   ${s.bold("groundrule check")}          before you push: checks what you changed`);
  println(io, `   ${s.bold("groundrule check --all")}    the full list above, any time`);
  println(io, `   ${s.bold("groundrule explain <ID>")}   why a rule exists and how to comply`);
  println(
    io,
    `   ${s.dim("Every pull request, for the whole team: https://docs.groundrule.dev/developers/cli/ci/")}`,
  );
  println(io);
  return EXIT.ok;
}
