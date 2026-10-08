import { renderTargets, syncOutputs } from "@groundrule/adapters";
import { appliesToRepository, effectiveStandards, inspectRepository } from "@groundrule/core";
import { EXIT, type IO, println, style } from "../io.js";
import { openWorkspace } from "../workspace.js";

export async function sync(
  io: IO,
  options: { check?: boolean; refresh?: boolean },
): Promise<number> {
  const workspace = await openWorkspace(io, options);
  if (!workspace) return EXIT.usage;
  const s = style(io);

  const repo = await inspectRepository(workspace);
  const standards = effectiveStandards(workspace)
    .map((l) => l.standard)
    .filter((standard) => appliesToRepository(standard, repo));
  const outputs = renderTargets({ standards, targets: workspace.config.targets });
  const changes = await syncOutputs(workspace.root, outputs, {
    dryRun: options.check ?? false,
    targets: workspace.config.targets,
  });
  const stale = changes.filter((c) => c.status !== "unchanged");
  const delivered = standards.filter((st) => st.spec.agent.instruction).length;

  if (options.check) {
    if (stale.length === 0) {
      println(io, `${s.green("✓")} Agent instructions are up to date (${delivered} standards).`);
      return EXIT.ok;
    }
    println(io, `${s.red("✕")} Agent instructions are out of date:`);
    for (const c of stale) println(io, `   ${c.path} ${s.dim(`would be ${c.status}`)}`);
    println(io, `   Run ${s.bold("groundrule sync")} and commit the result.`);
    return EXIT.failed;
  }

  println(io);
  println(
    io,
    ` ${s.bold("groundrule sync")} ${s.dim(`· ${delivered} standards → ${workspace.config.targets.join(", ")}`)}`,
  );
  println(io);
  const icon = {
    created: s.green("+"),
    updated: s.yellow("~"),
    removed: s.red("−"),
    unchanged: s.dim("="),
  };
  for (const c of changes) println(io, `   ${icon[c.status]} ${c.path} ${s.dim(c.status)}`);
  println(io);
  println(
    io,
    stale.length
      ? ` ${s.green("✓")} Done. Commit these files so every agent gets the same rules.`
      : ` ${s.green("✓")} Already up to date.`,
  );
  println(io);
  return EXIT.ok;
}
