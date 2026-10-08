import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MANAGED_BEGIN, MANAGED_END } from "@groundrule/core";
import { type OutputFile, OWNED_PATTERNS } from "./adapters.js";
import { SOURCE_NOTE } from "./render.js";

export const BEGIN = MANAGED_BEGIN;
export const END = MANAGED_END;

export interface SyncChange {
  path: string;
  status: "created" | "updated" | "unchanged" | "removed";
}

/** Insert or replace the Groundrule block in a file, leaving everything else untouched. */
export function upsertManagedBlock(existing: string | undefined, content: string): string {
  const block = `${BEGIN}\n<!-- ${SOURCE_NOTE} -->\n\n${content.trim()}\n${END}`;
  if (!existing?.trim()) return `${block}\n`;
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start >= 0 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + END.length);
  }
  return `${existing.trimEnd()}\n\n${block}\n`;
}

/**
 * Compute (and unless dryRun, apply) the file changes for a sync.
 * Stale owned files from earlier syncs (e.g. a removed scope) are removed.
 */
export async function syncOutputs(
  root: string,
  outputs: readonly OutputFile[],
  options: { dryRun?: boolean; targets?: readonly string[] } = {},
): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  for (const output of outputs) {
    const file = join(root, output.path);
    const existing = await readFile(file, "utf8").catch(() => undefined);
    const next =
      output.mode === "managed" ? upsertManagedBlock(existing, output.content) : output.content;
    const status = existing === undefined ? "created" : existing === next ? "unchanged" : "updated";
    changes.push({ path: output.path, status });
    if (!options.dryRun && status !== "unchanged") {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, next);
    }
  }

  const wanted = new Set(outputs.map((o) => o.path));
  for (const [target, pattern] of Object.entries(OWNED_PATTERNS)) {
    if (options.targets && !options.targets.includes(target)) continue;
    const dir = join(root, pattern.dir);
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const name of entries) {
      const rel = `${pattern.dir}/${name}`;
      if (pattern.match.test(name) && !wanted.has(rel)) {
        changes.push({ path: rel, status: "removed" });
        if (!options.dryRun) await rm(join(dir, name));
      }
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
