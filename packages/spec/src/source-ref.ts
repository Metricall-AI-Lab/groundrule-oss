/**
 * References to where standards come from, used by `extends` in configs and packs.
 *
 *   ./relative/path                     local path, relative to the declaring file
 *   github:owner/repo//path/in/repo     a path in a GitHub repository (default branch)
 *   github:owner/repo//path@ref         ... pinned to a tag, branch, or commit
 *   groundrule:packs/name               a pack published in the Groundrule community registry
 *   groundrule:packs/name@1.2.0         ... pinned to a version
 */
export type SourceRef =
  | { type: "local"; path: string }
  | { type: "github"; owner: string; repo: string; path: string; ref?: string }
  | { type: "registry"; name: string; version?: string };

const GITHUB = /^github:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?:\/\/([^@]*))?(?:@([^@\s]+))?$/;
const REGISTRY = /^groundrule:([a-z0-9]+(?:[-/][a-z0-9]+)*)(?:@([^@\s]+))?$/;

export class SourceRefError extends Error {
  override name = "SourceRefError";
}

export function parseSourceRef(input: string): SourceRef {
  const value = input.trim();
  if (value.startsWith("./") || value.startsWith("../")) {
    return { type: "local", path: value };
  }
  const gh = GITHUB.exec(value);
  if (gh) {
    const [, owner, repo, path, ref] = gh as unknown as [string, string, string, string?, string?];
    return {
      type: "github",
      owner,
      repo,
      path: (path ?? "").replace(/^\/+|\/+$/g, ""),
      ...(ref ? { ref } : {}),
    };
  }
  const reg = REGISTRY.exec(value);
  if (reg) {
    const [, name, version] = reg as unknown as [string, string, string?];
    return { type: "registry", name, ...(version ? { version } : {}) };
  }
  throw new SourceRefError(
    `Unrecognized source "${input}". Use ./path, github:owner/repo//path[@ref], or groundrule:packs/name[@version].`,
  );
}

export function formatSourceRef(ref: SourceRef): string {
  switch (ref.type) {
    case "local":
      return ref.path;
    case "github":
      return `github:${ref.owner}/${ref.repo}${ref.path ? `//${ref.path}` : ""}${ref.ref ? `@${ref.ref}` : ""}`;
    case "registry":
      return `groundrule:${ref.name}${ref.version ? `@${ref.version}` : ""}`;
  }
}

export function isValidSourceRef(input: string): boolean {
  try {
    parseSourceRef(input);
    return true;
  } catch {
    return false;
  }
}
