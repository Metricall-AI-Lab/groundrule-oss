import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  type Config,
  type ExceptionEntry,
  formatSourceRef,
  isExceptionActive,
  type Pack,
  parseSourceRef,
  type Severity,
  type Standard,
} from "@groundrule/spec";
import type { Diagnostic } from "./diagnostics.js";
import { exists, globFiles, toPosix } from "./fs.js";
import { isGroundruleDocument, stripManagedBlocks } from "./generated.js";
import { gitRoot } from "./git.js";
import { loadFile } from "./load.js";
import { resolveRemoteSource, type SourceOptions } from "./sources.js";

export const CONFIG_DIR = ".groundrule";
export const CONFIG_FILE = "config.yaml";

export interface LoadedStandard {
  /** The standard with config overrides applied. */
  standard: Standard;
  /** Absolute path of the file that defines it. */
  file: string;
  /** Where it came from: "local", or the extends reference, e.g. groundrule:packs/security-baseline. */
  origin: string;
  /** Turned off by a config override. */
  disabled: boolean;
  /** Severity before overrides, when an override changed it. */
  originalSeverity?: Severity;
  overrideReason?: string;
}

export interface Workspace {
  /** Repository root: the git root, or the directory containing .groundrule. */
  root: string;
  configFile: string;
  config: Config;
  standards: LoadedStandard[];
  exceptions: ExceptionEntry[];
  diagnostics: Diagnostic[];
}

export type WorkspaceResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; diagnostics: Diagnostic[] };

/** Walk up from `cwd` to find .groundrule/config.yaml, stopping at the git root. */
export async function findConfig(cwd: string): Promise<string | undefined> {
  const stop = await gitRoot(cwd);
  // Real paths, so results agree with git (e.g. macOS /var -> /private/var).
  let dir = await realpath(resolve(cwd)).catch(() => resolve(cwd));
  for (;;) {
    const candidate = join(dir, CONFIG_DIR, CONFIG_FILE);
    if (await exists(candidate)) return candidate;
    if (dir === stop) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load the effective configuration for a repository: config, inherited packs,
 * local standards, overrides, and exceptions. Problems become diagnostics;
 * the result is `ok: false` only if any diagnostic is an error.
 */
export async function loadWorkspace(
  options: { cwd: string } & SourceOptions,
): Promise<WorkspaceResult> {
  const configFile = await findConfig(options.cwd);
  if (!configFile) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          file: join(resolve(options.cwd), CONFIG_DIR, CONFIG_FILE),
          message: "No Groundrule config found. Run `groundrule init` to create one.",
        },
      ],
    };
  }

  const configDir = dirname(configFile);
  const root = (await gitRoot(configDir)) ?? dirname(configDir);
  const diagnostics: Diagnostic[] = [];

  const configResult = await loadFile(configFile, "Config");
  if (!configResult.ok) return { ok: false, diagnostics: configResult.diagnostics };
  const config = configResult.document;

  const standards: LoadedStandard[] = [];
  const seen = new Map<string, string>();
  const visitedPacks = new Set<string>();

  const addStandardFile = async (file: string, origin: string) => {
    const result = await loadFile(file, "Standard");
    if (!result.ok) {
      diagnostics.push(...result.diagnostics);
      return;
    }
    const standard = result.document;
    const id = standard.metadata.id;
    const previous = seen.get(id);
    if (previous) {
      diagnostics.push({
        severity: "error",
        file,
        path: "metadata.id",
        message: `Duplicate standard ${id}; also defined in ${displayPath(root, previous)}. Use config overrides to change an inherited standard.`,
      });
      return;
    }
    seen.set(id, file);
    standards.push({ standard, file, origin, disabled: false });
  };

  const loadPackFile = async (packFile: string, origin: string, chain: string[]): Promise<void> => {
    if (chain.includes(packFile)) {
      diagnostics.push({
        severity: "error",
        file: packFile,
        message: "Pack extends itself (circular extends).",
      });
      return;
    }
    if (visitedPacks.has(packFile)) return;
    visitedPacks.add(packFile);
    const result = await loadFile(packFile, "Pack");
    if (!result.ok) {
      diagnostics.push(...result.diagnostics);
      return;
    }
    const pack: Pack = result.document;
    for (const ref of pack.spec.extends) {
      await loadSource(ref, dirname(packFile), packFile, [...chain, packFile]);
    }
    for (const file of await globFiles(dirname(packFile), pack.spec.include)) {
      if (file !== packFile) await addStandardFile(file, origin);
    }
  };

  const loadSource = async (
    input: string,
    fromDir: string,
    declaredIn: string,
    chain: string[],
  ): Promise<void> => {
    const ref = parseSourceRef(input);
    let target: string;
    try {
      target =
        ref.type === "local" ? resolve(fromDir, ref.path) : await resolveRemoteSource(ref, options);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        file: declaredIn,
        path: "extends",
        message: (error as Error).message,
      });
      return;
    }
    const origin =
      ref.type === "local"
        ? `local:${toPosix(relative(root, target)) || "."}`
        : formatSourceRef(ref);
    const kind = await exists(target);
    if (kind === "file") return loadPackFile(target, origin, chain);
    if (kind === "dir") {
      const packFile = join(target, "pack.yaml");
      if (await exists(packFile)) return loadPackFile(packFile, origin, chain);
      for (const file of await globFiles(target, ["**/*.yaml", "**/*.yml"]))
        await addStandardFile(file, origin);
      return;
    }
    diagnostics.push({
      severity: "error",
      file: declaredIn,
      path: "extends",
      message: `"${input}" does not exist (resolved to ${target}).`,
    });
  };

  for (const ref of config.extends) await loadSource(ref, configDir, configFile, []);
  for (const file of await globFiles(configDir, config.standards))
    await addStandardFile(file, "local");

  // Overrides
  for (const [id, override] of Object.entries(config.overrides)) {
    const loaded = standards.find((s) => s.standard.metadata.id === id);
    if (!loaded) {
      diagnostics.push({
        severity: "warning",
        file: configFile,
        path: `overrides.${id}`,
        message: `Override for unknown standard ${id}.`,
      });
      continue;
    }
    if (override.disabled) loaded.disabled = true;
    if (override.severity && override.severity !== loaded.standard.spec.severity) {
      loaded.originalSeverity = loaded.standard.spec.severity;
      loaded.standard = {
        ...loaded.standard,
        spec: { ...loaded.standard.spec, severity: override.severity },
      };
    }
    if (override.reason) loaded.overrideReason = override.reason;
  }

  // Exceptions
  const exceptions: ExceptionEntry[] = [];
  const exceptionsFile = join(configDir, "exceptions.yaml");
  if (await exists(exceptionsFile)) {
    const result = await loadFile(exceptionsFile, "ExceptionList");
    if (!result.ok) diagnostics.push(...result.diagnostics);
    else {
      for (const entry of result.document.spec.exceptions) {
        if (!seen.has(entry.standard)) {
          diagnostics.push({
            severity: "warning",
            file: exceptionsFile,
            message: `${entry.id} refers to unknown standard ${entry.standard}.`,
          });
        }
        if (!isExceptionActive(entry)) {
          diagnostics.push({
            severity: "warning",
            file: exceptionsFile,
            message: `${entry.id} for ${entry.standard} expired on ${entry.expires} and no longer applies.`,
          });
        }
        exceptions.push(entry);
      }
    }
  }

  standards.sort((a, b) => a.standard.metadata.id.localeCompare(b.standard.metadata.id));
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };
  return { ok: true, workspace: { root, configFile, config, standards, exceptions, diagnostics } };
}

/** Standards that are in effect: active or deprecated, and not disabled. */
export function effectiveStandards(workspace: Pick<Workspace, "standards">): LoadedStandard[] {
  return workspace.standards.filter(
    (s) =>
      !s.disabled &&
      (s.standard.metadata.status === "active" || s.standard.metadata.status === "deprecated"),
  );
}

export function displayPath(root: string, file: string): string {
  const rel = toPosix(relative(root, file));
  return rel.startsWith("..") ? file : rel;
}

export function repositoryName(root: string): string {
  return basename(root);
}

/**
 * Read a repository file relative to the root, as evaluators should see it:
 * Groundrule documents read as empty and managed blocks are blanked out.
 */
export function repoReader(root: string) {
  return async (path: string) => {
    const text = await readFile(join(root, path), "utf8");
    return isGroundruleDocument(path, text) ? "" : stripManagedBlocks(text);
  };
}
