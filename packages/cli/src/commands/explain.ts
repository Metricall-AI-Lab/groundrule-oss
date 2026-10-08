import { displayPath } from "@groundrule/core";
import { type Example, isExceptionActive } from "@groundrule/spec";
import { EXIT, eprintln, type IO, println, style } from "../io.js";
import { openWorkspace } from "../workspace.js";

const SOURCES: Record<string, string> = {
  files: "deterministic",
  regex: "deterministic",
  dependencies: "deterministic",
  "change-set": "deterministic",
  semgrep: "static analysis",
  llm: "AI",
};

export async function explain(io: IO, id: string): Promise<number> {
  const workspace = await openWorkspace(io);
  if (!workspace) return EXIT.usage;
  const wanted = id.toUpperCase();
  const loaded = workspace.standards.find((l) => l.standard.metadata.id === wanted);
  if (!loaded) {
    const close = workspace.standards
      .map((l) => l.standard.metadata.id)
      .filter((x) => x.split("-")[0] === wanted.split("-")[0]);
    eprintln(
      io,
      `✕ No standard ${wanted}.${close.length ? ` Did you mean ${close.slice(0, 3).join(", ")}?` : " Run `groundrule standards` to list them."}`,
    );
    return EXIT.usage;
  }

  const s = style(io);
  const { metadata, spec } = loaded.standard;
  const text = (t: string) => t.replace(/\s+/g, " ").trim();
  const section = (title: string) => {
    println(io);
    println(io, ` ${s.bold(title)}`);
  };

  println(io);
  println(io, ` ${s.bold(metadata.id)}  ${metadata.title}`);
  const severity = loaded.originalSeverity
    ? `${spec.severity} (overridden from ${loaded.originalSeverity}${loaded.overrideReason ? `: ${loaded.overrideReason}` : ""})`
    : spec.severity;
  println(
    io,
    ` ${s.dim([severity, metadata.type, `v${metadata.version}`, metadata.status, metadata.owner && `owned by ${metadata.owner}`].filter(Boolean).join(" · "))}`,
  );
  if (loaded.disabled)
    println(
      io,
      ` ${s.yellow(`Disabled in this repository${loaded.overrideReason ? `: ${loaded.overrideReason}` : ""}`)}`,
    );

  section("Requirement");
  println(io, `   ${text(spec.requirement)}`);
  if (spec.intent) {
    section("Why");
    println(io, `   ${text(spec.intent)}`);
  }
  if (spec.rationale) println(io, `   ${text(spec.rationale)}`);

  const scope = [
    spec.scope.paths?.length && `paths ${spec.scope.paths.join(", ")}`,
    spec.scope.exclude?.length && `except ${spec.scope.exclude.join(", ")}`,
    spec.scope.languages?.length && `languages ${spec.scope.languages.join(", ")}`,
    spec.scope.frameworks?.length && `frameworks ${spec.scope.frameworks.join(", ")}`,
    spec.scope.tags?.length && `tags ${spec.scope.tags.join(", ")}`,
    spec.scope.repositories?.length && `repositories ${spec.scope.repositories.join(", ")}`,
  ].filter(Boolean);
  section("Applies to");
  println(io, `   ${scope.length ? scope.join(" · ") : "Everything in the repository"}`);

  const examples = (label: string, list: Example[] | undefined, mark: string) => {
    for (const example of list ?? []) {
      const code = typeof example === "string" ? example : example.code;
      const note = typeof example === "string" ? undefined : example.note;
      println(io, `   ${mark} ${label}${note ? s.dim(` (${note})`) : ""}`);
      for (const line of code.trimEnd().split("\n")) println(io, `       ${line}`);
    }
  };
  if (spec.examples?.approved?.length || spec.examples?.forbidden?.length) {
    section("Examples");
    examples("Do", spec.examples?.approved, s.green("✓"));
    examples("Don't", spec.examples?.forbidden, s.red("✕"));
  }

  if (spec.remediation) {
    section("How to fix");
    println(io, `   ${text(spec.remediation)}`);
  }

  section("How it's checked");
  if (spec.checks.length === 0)
    println(io, "   Agent and reviewer guidance only; no automated check.");
  for (const c of spec.checks)
    println(io, `   • ${c.evaluator} ${s.dim(`(${SOURCES[c.evaluator] ?? "plugin"})`)}`);
  if (spec.agent.instruction)
    println(io, `   • delivered to coding agents via ${workspace.config.targets.join(", ")}`);

  const exceptions = workspace.exceptions.filter((e) => e.standard === metadata.id);
  section("Exceptions");
  if (spec.exceptions?.approvers?.length)
    println(
      io,
      `   Approved by ${spec.exceptions.approvers.join(", ")}${spec.exceptions.maxDurationDays ? `, for up to ${spec.exceptions.maxDurationDays} days` : ""}.`,
    );
  if (exceptions.length === 0)
    println(
      io,
      `   None. To request one, add an entry to .groundrule/exceptions.yaml with a reason and expiry.`,
    );
  for (const e of exceptions) {
    const active = isExceptionActive(e);
    println(
      io,
      `   ${active ? s.green("●") : s.dim("○")} ${e.id} ${e.paths.join(", ")} ${s.dim(`until ${e.expires}${active ? "" : " (expired)"}`)} — ${e.reason}`,
    );
  }

  if (spec.references?.length) {
    section("References");
    for (const ref of spec.references) println(io, `   ${ref}`);
  }
  println(io);
  println(
    io,
    ` ${s.dim(`Defined in ${displayPath(workspace.root, loaded.file)} (${loaded.origin})`)}`,
  );
  println(io);
  return EXIT.ok;
}
