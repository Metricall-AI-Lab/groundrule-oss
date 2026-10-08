import { afterEach, describe, expect, it } from "vitest";
import { getChanges, isChangedLine, listGitFiles, parseUnifiedDiff } from "../src/index.js";
import { tempRepo } from "./repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("parseUnifiedDiff", () => {
  it("parses added ranges, new, deleted, and renamed files", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@ ctx",
      "+x",
      "+y",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "@@ -20,2 +21,0 @@",
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,3 @@",
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "diff --git a/old.ts b/moved.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to moved.ts",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual([
      {
        path: "src/a.ts",
        status: "modified",
        changedLines: [
          { start: 4, end: 5 },
          { start: 12, end: 12 },
        ],
      },
      { path: "new.ts", status: "added", changedLines: [{ start: 1, end: 3 }] },
      { path: "gone.ts", status: "deleted", changedLines: [] },
      { path: "moved.ts", status: "renamed", previousPath: "old.ts", changedLines: [] },
    ]);
  });

  it("checks line overlap", () => {
    const change = { path: "a", status: "modified" as const, changedLines: [{ start: 4, end: 5 }] };
    expect(isChangedLine(change, 5)).toBe(true);
    expect(isChangedLine(change, 1, 4)).toBe(true);
    expect(isChangedLine(change, 6)).toBe(false);
    expect(isChangedLine(undefined, 1)).toBe(false);
  });
});

describe("git", () => {
  it("lists tracked and untracked files, respecting .gitignore and deletions", async () => {
    const r = await tempRepo({ ".gitignore": "secret.txt\n", "a.ts": "", "gone.ts": "" });
    cleanups.push(r.cleanup);
    await r.write("b.ts", "");
    await r.write("secret.txt", "");
    r.git("rm", "-q", "--cached", "gone.ts");
    const { rm } = await import("node:fs/promises");
    await rm(`${r.root}/gone.ts`);
    expect(await listGitFiles(r.root)).toEqual([".gitignore", "a.ts", "b.ts"]);
  });

  it("reports uncommitted changes and untracked files", async () => {
    const r = await tempRepo({ "a.ts": "1\n2\n3\n" });
    cleanups.push(r.cleanup);
    await r.write("a.ts", "1\nTWO\n3\n4\n");
    await r.write("new.ts", "x\ny\n");
    expect(await getChanges(r.root)).toEqual([
      {
        path: "a.ts",
        status: "modified",
        changedLines: [
          { start: 2, end: 2 },
          { start: 4, end: 4 },
        ],
      },
      { path: "new.ts", status: "added", changedLines: [{ start: 1, end: 2 }] },
    ]);
  });

  it("compares against a base branch from the merge base", async () => {
    const r = await tempRepo({ "a.ts": "1\n" });
    cleanups.push(r.cleanup);
    r.git("checkout", "-q", "-b", "feature");
    await r.write("b.ts", "b\n");
    r.git("add", "-A");
    r.git("commit", "-q", "-m", "feature");
    r.git("checkout", "-q", "main");
    await r.write("main-only.ts", "m\n");
    r.git("add", "-A");
    r.git("commit", "-q", "-m", "main moves on");
    r.git("checkout", "-q", "feature");
    expect((await getChanges(r.root, "main")).map((c) => c.path)).toEqual(["b.ts"]);
  });

  it("treats every file as added in a repository without commits", async () => {
    const r = await tempRepo({ "a.ts": "1\n" }, { commit: false });
    cleanups.push(r.cleanup);
    expect(await getChanges(r.root)).toEqual([
      { path: "a.ts", status: "added", changedLines: [{ start: 1, end: 1 }] },
    ]);
  });

  it("explains an unknown base", async () => {
    const r = await tempRepo({ "a.ts": "1\n" });
    cleanups.push(r.cleanup);
    await expect(getChanges(r.root, "origin/nope")).rejects.toThrow(/Fetch it first/);
  });
});
