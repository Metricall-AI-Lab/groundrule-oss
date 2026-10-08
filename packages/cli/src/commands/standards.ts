import { appliesToRepository, displayPath, inspectRepository } from "@groundrule/core";
import { compareSeverity } from "@groundrule/spec";
import { EXIT, type IO, println, style } from "../io.js";
import { openWorkspace } from "../workspace.js";

export async function standards(io: IO, options: { json?: boolean }): Promise<number> {
  const workspace = await openWorkspace(io);
  if (!workspace) return EXIT.usage;
  const repo = await inspectRepository(workspace);
  const rows = workspace.standards
    .map((l) => ({
      id: l.standard.metadata.id,
      title: l.standard.metadata.title,
      severity: l.standard.spec.severity,
      status: l.disabled ? "disabled" : l.standard.metadata.status,
      applies: appliesToRepository(l.standard, repo),
      checks: l.standard.spec.checks.map((c) => c.evaluator),
      paths: l.standard.spec.scope.paths ?? [],
      origin: l.origin,
      file: displayPath(workspace.root, l.file),
    }))
    .sort((a, b) => compareSeverity(b.severity, a.severity) || a.id.localeCompare(b.id));

  if (options.json) {
    io.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return EXIT.ok;
  }

  const s = style(io);
  const width = Math.max(...rows.map((r) => r.id.length), 2);
  println(io);
  println(
    io,
    ` ${s.bold("Standards")} ${s.dim(`· ${rows.filter((r) => r.applies && r.status === "active").length} in effect of ${rows.length}`)}`,
  );
  println(io);
  for (const r of rows) {
    const inactive = !r.applies || r.status !== "active";
    const padded = r.severity.padEnd(8);
    const sev =
      r.severity === "blocker"
        ? s.red(padded)
        : r.severity === "warning"
          ? s.yellow(padded)
          : s.dim(padded);
    const checks = r.checks.length ? r.checks.join(", ") : "agent guidance";
    const note =
      r.status !== "active"
        ? ` ${s.dim(`(${r.status})`)}`
        : !r.applies
          ? ` ${s.dim("(not applicable here)")}`
          : "";
    const line = ` ${r.id.padEnd(width)}  ${sev}  ${r.title}${note}`;
    println(io, inactive ? s.dim(line) : line);
    println(
      io,
      ` ${" ".repeat(width)}  ${" ".repeat(8)}  ${s.dim(`${checks}${r.paths.length ? ` · ${r.paths.join(", ")}` : ""} · ${r.origin}`)}`,
    );
  }
  println(io);
  return EXIT.ok;
}
