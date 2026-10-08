import { dirname, relative } from "node:path";
import type { Standard } from "@groundrule/spec";
import { detectFrameworks } from "./frameworks.js";
import { toPosix, walkFiles } from "./fs.js";
import { isGeneratedFile } from "./generated.js";
import { gitRoot, listGitFiles } from "./git.js";
import { detectLanguages } from "./languages.js";
import { matchesScope } from "./scope.js";
import { repoReader, repositoryName, type Workspace } from "./workspace.js";

export interface RepositoryInfo {
  root: string;
  name: string;
  inGit: boolean;
  /** Repository files, excluding Groundrule's own directory and generated agent files. */
  files: string[];
  /** e.g. ".groundrule/" — never evaluated. */
  configPrefix: string;
  languages: string[];
  frameworks: string[];
  tags: readonly string[];
}

const MANIFEST =
  /(^|\/)(package\.json|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml|requirements[^/]*\.txt)$/;

/** Files, languages, frameworks, and tags of the repository a workspace belongs to. */
export async function inspectRepository(
  workspace: Workspace,
  files?: readonly string[],
): Promise<RepositoryInfo> {
  const { root } = workspace;
  const inGit = (await gitRoot(root)) !== undefined;
  const configPrefix = `${toPosix(relative(root, dirname(workspace.configFile)))}/`;
  const all = files ? [...files] : inGit ? await listGitFiles(root) : await walkFiles(root);
  const kept = all.filter((f) => !f.startsWith(configPrefix) && !isGeneratedFile(f));
  return {
    root,
    name: repositoryName(root),
    inGit,
    files: kept,
    configPrefix,
    languages: detectLanguages(kept),
    frameworks: await detectFrameworks(
      kept.filter((f) => MANIFEST.test(f)),
      repoReader(root),
    ),
    tags: workspace.config.tags,
  };
}

/** True if a standard applies to this repository (languages, frameworks, tags, repository name). */
export function appliesToRepository(standard: Standard, repo: RepositoryInfo): boolean {
  const { paths: _paths, exclude: _exclude, ...repoScope } = standard.spec.scope;
  return matchesScope(repoScope, {
    repository: repo.name,
    languages: repo.languages,
    frameworks: repo.frameworks,
    tags: repo.tags,
  });
}
