import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A throwaway git repository for integration tests. */
export async function tempRepo(files: Record<string, string>, { commit = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    }).toString();
  git("init", "-q", "-b", "main");
  const write = async (rel: string, content: string) => {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  };
  for (const [rel, content] of Object.entries(files)) await write(rel, content);
  if (commit) {
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  }
  return {
    root,
    git,
    write,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export const CONFIG = (extra = "") => `apiVersion: groundrule.dev/v1alpha1
kind: Config
${extra}
`;

export function standardYaml(id: string, spec: string, metadata = "") {
  return `apiVersion: groundrule.dev/v1alpha1
kind: Standard
metadata:
  id: ${id}
  title: ${id} title
  type: requirement
${metadata}
spec:
${spec}
`;
}
