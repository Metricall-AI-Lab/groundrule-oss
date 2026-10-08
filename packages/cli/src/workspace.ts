import {
  type Diagnostic,
  displayPath,
  formatDiagnostic,
  loadWorkspace,
  type Workspace,
} from "@groundrule/core";
import { resolvePack } from "@groundrule/packs";
import { eprintln, type IO, style } from "./io.js";

/** Load the workspace, printing diagnostics. Returns undefined on errors (exit 2). */
export async function openWorkspace(
  io: IO,
  options: { refresh?: boolean } = {},
): Promise<Workspace | undefined> {
  const result = await loadWorkspace({
    cwd: io.cwd,
    resolveRegistry: resolvePack,
    ...(options.refresh ? { refresh: true } : {}),
  });
  if (!result.ok) {
    printDiagnostics(io, result.diagnostics, io.cwd);
    return undefined;
  }
  printDiagnostics(io, result.workspace.diagnostics, result.workspace.root);
  return result.workspace;
}

export function printDiagnostics(io: IO, diagnostics: readonly Diagnostic[], root: string) {
  const s = style(io, "stderr");
  for (const d of diagnostics) {
    const icon = d.severity === "error" ? s.red("✕") : s.yellow("!");
    eprintln(io, `${icon} ${formatDiagnostic({ ...d, file: displayPath(root, d.file) })}`);
  }
}
