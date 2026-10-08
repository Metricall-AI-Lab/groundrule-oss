import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFile } from "@groundrule/core";

/** Directory containing one folder per pack, each with a pack.yaml. */
export const CATALOG_DIR = fileURLToPath(new URL("../catalog/", import.meta.url));

const NAME = /^packs\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/**
 * Resolve a registry name like "packs/security-baseline" to the bundled pack directory.
 * Bundled packs are versioned with the CLI, so a requested version is not used yet.
 */
export function resolvePack(name: string): string | undefined {
  const id = NAME.exec(name)?.[1];
  return id && KNOWN.has(id) ? join(CATALOG_DIR, id) : undefined;
}

export interface PackInfo {
  id: string;
  ref: string;
  title: string;
  description?: string;
  standards: number;
}

export async function listPacks(): Promise<PackInfo[]> {
  const packs: PackInfo[] = [];
  for (const id of [...KNOWN].sort()) {
    const result = await loadFile(join(CATALOG_DIR, id, "pack.yaml"), "Pack");
    if (!result.ok) continue;
    const files = await readdir(join(CATALOG_DIR, id, "standards")).catch(() => [] as string[]);
    packs.push({
      id,
      ref: `groundrule:packs/${id}`,
      title: result.document.metadata.title,
      ...(result.document.metadata.description
        ? { description: result.document.metadata.description }
        : {}),
      standards: files.filter((f) => f.endsWith(".yaml")).length,
    });
  }
  return packs;
}

/** Bundled packs. Listed explicitly so a stray folder never becomes a pack. */
const KNOWN = new Set(["security-baseline", "typescript-node", "java-spring"]);
