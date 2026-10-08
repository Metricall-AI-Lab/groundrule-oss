import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SourceRef } from "@groundrule/spec";
import { exists } from "./fs.js";

const exec = promisify(execFile);

export interface SourceOptions {
  /** Where remote sources are cached. Default: ~/.cache/groundrule/sources */
  cacheDir?: string;
  /** Re-fetch remote sources even if cached. */
  refresh?: boolean;
  /** Resolve `groundrule:` registry names to a local directory (the CLI bundles packs). */
  resolveRegistry?: (name: string, version?: string) => string | undefined;
  /** Base URL for GitHub clones. Overridable for tests and GitHub Enterprise. */
  githubBaseUrl?: string;
}

export class SourceError extends Error {
  override name = "SourceError";
}

/** Resolve a non-local source reference to an absolute directory or file path. */
export async function resolveRemoteSource(
  ref: Exclude<SourceRef, { type: "local" }>,
  options: SourceOptions = {},
) {
  if (ref.type === "registry") {
    const path = options.resolveRegistry?.(ref.name, ref.version);
    if (!path)
      throw new SourceError(
        `Unknown pack "groundrule:${ref.name}". Run \`groundrule packs\` to list them.`,
      );
    return path;
  }

  const cacheRoot =
    options.cacheDir ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "groundrule", "sources");
  const checkout = join(cacheRoot, "github", ref.owner, ref.repo, ref.ref ?? "_default");
  // Unpinned refs always re-fetch so they track the default branch.
  const fresh = options.refresh || !ref.ref;
  if (fresh || !(await exists(join(checkout, ".git")))) {
    await rm(checkout, { recursive: true, force: true });
    await mkdir(checkout, { recursive: true });
    const base = (
      options.githubBaseUrl ??
      process.env.GROUNDRULE_GITHUB_BASE_URL ??
      "https://github.com"
    ).replace(/\/$/, "");
    const url = `${base}/${ref.owner}/${ref.repo}${base.startsWith("file:") ? "" : ".git"}`;
    const args = [
      "clone",
      "--quiet",
      "--depth",
      "1",
      ...(ref.ref ? ["--branch", ref.ref] : []),
      url,
      checkout,
    ];
    try {
      await exec("git", args, { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    } catch (error) {
      await rm(checkout, { recursive: true, force: true });
      const detail =
        error instanceof Error && "stderr" in error
          ? String((error as { stderr: unknown }).stderr).trim()
          : "";
      throw new SourceError(
        `Cannot fetch github:${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ""}. Check the name, the ref, and your git access.${detail ? ` (${detail.split("\n")[0]})` : ""}`,
      );
    }
  }
  return ref.path ? join(checkout, ref.path) : checkout;
}
