import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import picomatch from "picomatch";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".turbo",
  "dist",
  "build",
  "target",
  ".venv",
  "__pycache__",
]);

/** Convert a platform path to a POSIX, repository-relative style path. */
export function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** Recursively list files under `dir`, relative to it, skipping VCS and build directories. */
export async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(current: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(full);
      } else if (entry.isFile()) {
        out.push(toPosix(relative(dir, full)));
      }
    }
  }
  await visit(dir);
  return out.sort();
}

/** Files under `dir` matching any of the globs (relative to `dir`). Absolute paths, sorted. */
export async function globFiles(dir: string, globs: readonly string[]): Promise<string[]> {
  if (globs.length === 0) return [];
  const isMatch = picomatch(globs as string[], { dot: true });
  return (await walkFiles(dir)).filter((f) => isMatch(f)).map((f) => join(dir, f));
}

export async function exists(path: string): Promise<"file" | "dir" | undefined> {
  try {
    const s = await stat(path);
    return s.isDirectory() ? "dir" : s.isFile() ? "file" : undefined;
  } catch {
    return undefined;
  }
}
