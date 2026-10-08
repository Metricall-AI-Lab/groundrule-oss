import {
  type Diagnostic,
  displayPath,
  formatDiagnostic,
  loadWorkspace,
  type Workspace,
} from "@groundrule/core";
import { resolvePack } from "@groundrule/packs";
import { eprintln, type IO, style } from "./io.js";
import {
  loadPlatformStandards,
  PlatformError,
  type PlatformRulebook,
  type Use,
} from "./platform.js";

export interface OpenOptions {
  refresh?: boolean;
  /**
   * Which platform rules this command needs (only when the config has `platform:`):
   * agent files get Teach and above, checks run Advise and above.
   */
  use?: Use;
}

export interface OpenedWorkspace extends Workspace {
  /** Set when standards came from the platform. */
  platform?: { url: string; rulebook: PlatformRulebook };
}

/** Load the workspace, printing diagnostics. Returns undefined on errors (exit 2). */
export async function openWorkspace(
  io: IO,
  options: OpenOptions = {},
): Promise<OpenedWorkspace | undefined> {
  const result = await loadWorkspace({
    cwd: io.cwd,
    resolveRegistry: resolvePack,
    ...(options.refresh ? { refresh: true } : {}),
  });
  if (!result.ok) {
    printDiagnostics(io, result.diagnostics, io.cwd);
    return undefined;
  }
  const workspace: OpenedWorkspace = result.workspace;
  if (workspace.config.platform) {
    try {
      await usePlatform(io, workspace, options.use ?? "all");
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;
      printDiagnostics(io, workspace.diagnostics, workspace.root);
      eprintln(io, `${style(io, "stderr").red("✕")} ${error.message}`);
      return undefined;
    }
  }
  printDiagnostics(io, workspace.diagnostics, workspace.root);
  return workspace;
}

/**
 * Replace inherited standards with the organization's rulebook from the platform. The
 * repository's own standards (.groundrule/standards) still apply; on an ID clash the
 * platform wins, so a repository can't quietly loosen an organization rule.
 */
async function usePlatform(io: IO, workspace: OpenedWorkspace, use: Use) {
  const { config, configFile, root } = workspace;
  const loaded = await loadPlatformStandards(io, config, root, configFile, use);
  const diagnostics: Diagnostic[] = [...loaded.diagnostics];
  if (config.extends.length) {
    diagnostics.push({
      severity: "warning",
      file: configFile,
      path: "extends",
      message: "Ignored because `platform` is set: your organization's rulebook decides the packs.",
    });
  }
  const platformIds = new Set(loaded.standards.map((s) => s.standard.metadata.id));
  const local = workspace.standards.filter((s) => s.origin === "local");
  for (const s of local) {
    if (platformIds.has(s.standard.metadata.id)) {
      diagnostics.push({
        severity: "warning",
        file: s.file,
        path: "metadata.id",
        message: `${s.standard.metadata.id} is also an organization rule; the organization's version applies. Give this one a new ID.`,
      });
    }
  }
  for (const id of Object.keys(config.overrides)) {
    if (platformIds.has(id)) {
      diagnostics.push({
        severity: "warning",
        file: configFile,
        path: `overrides.${id}`,
        message: `${id} comes from the platform; change it in Groundrule (for this repository or its team), not in config.`,
      });
    }
  }
  // Drop the "unknown standard" warnings for overrides now that inherited packs are gone.
  workspace.diagnostics = workspace.diagnostics.filter(
    (d) => !(d.path?.startsWith("overrides.") && d.message.startsWith("Override for unknown")),
  );
  workspace.standards = [
    ...loaded.standards,
    ...local.filter((s) => !platformIds.has(s.standard.metadata.id)),
  ].sort((a, b) => a.standard.metadata.id.localeCompare(b.standard.metadata.id));
  workspace.diagnostics.push(...diagnostics);
  workspace.platform = { url: loaded.url, rulebook: loaded.rulebook };
}

export function printDiagnostics(io: IO, diagnostics: readonly Diagnostic[], root: string) {
  const s = style(io, "stderr");
  for (const d of diagnostics) {
    const icon = d.severity === "error" ? s.red("✕") : s.yellow("!");
    eprintln(io, `${icon} ${formatDiagnostic({ ...d, file: displayPath(root, d.file) })}`);
  }
}
