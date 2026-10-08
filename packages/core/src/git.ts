import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, LineRange } from "./evaluator.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}

/** Repository root containing `cwd`, or undefined when not inside a git repository. */
export async function gitRoot(cwd: string): Promise<string | undefined> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return undefined;
  }
}

/** Tracked files plus untracked files that are not ignored, repository-relative. */
export async function listGitFiles(root: string): Promise<string[]> {
  const out = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const files = new Set(out.split("\0").filter(Boolean));
  // Deleted-but-tracked files still appear in --cached; drop them.
  const deleted = (await git(root, ["ls-files", "-z", "--deleted"])).split("\0").filter(Boolean);
  for (const file of deleted) files.delete(file);
  return [...files].sort();
}

export class GitError extends Error {
  override name = "GitError";
}

/**
 * Changes in the working tree relative to `base`.
 * - No base: uncommitted changes (staged + unstaged) against HEAD, plus untracked files.
 * - With base (e.g. origin/main): everything since the merge base, plus uncommitted work.
 * In a repository without commits, every file counts as added.
 */
export async function getChanges(root: string, base?: string): Promise<ChangedFile[]> {
  const hasHead = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(
    () => true,
    () => false,
  );

  let diffBase: string | undefined;
  if (base) {
    try {
      diffBase = (await git(root, ["merge-base", base, "HEAD"])).trim();
    } catch {
      throw new GitError(
        `Cannot compare against "${base}". Fetch it first (e.g. git fetch origin main).`,
      );
    }
  } else if (hasHead) {
    diffBase = "HEAD";
  }

  const changes = new Map<string, ChangedFile>();
  if (diffBase) {
    const diff = await git(root, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=0",
      "--find-renames",
      diffBase,
      "--",
    ]);
    for (const change of parseUnifiedDiff(diff)) changes.set(change.path, change);
  }

  const untracked = hasHead
    ? (await git(root, ["ls-files", "-z", "--others", "--exclude-standard"]))
        .split("\0")
        .filter(Boolean)
    : await listGitFiles(root);
  for (const path of untracked) {
    if (changes.has(path)) continue;
    const lines = await countLines(join(root, path));
    changes.set(path, {
      path,
      status: "added",
      changedLines: lines > 0 ? [{ start: 1, end: lines }] : [],
    });
  }
  return [...changes.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function countLines(file: string): Promise<number> {
  try {
    const text = await readFile(file, "utf8");
    if (text.length === 0) return 0;
    return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  } catch {
    return 0;
  }
}

/** Parse `git diff --unified=0` output into changed files and added-line ranges. */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: (ChangedFile & { changedLines: LineRange[] }) | undefined;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      current = { path: match?.[2] ?? "", status: "modified", changedLines: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.previousPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) current.path = line.slice("rename to ".length);
    else if (line.startsWith("+++ ") && line !== "+++ /dev/null") current.path = line.slice(6);
    else if (line.startsWith("@@")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!hunk?.[1]) continue;
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) current.changedLines.push({ start, end: start + count - 1 });
    }
  }
  if (current) files.push(current);
  return files.filter((f) => f.path);
}

/** True if the line range overlaps any changed range of the file. */
export function isChangedLine(
  change: ChangedFile | undefined,
  startLine: number,
  endLine = startLine,
): boolean {
  if (!change) return false;
  return change.changedLines.some((r) => startLine <= r.end && endLine >= r.start);
}
