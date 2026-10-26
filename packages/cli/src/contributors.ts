// The contributor digest (RFC 0014): salted SHA-256 hashes of the distinct commit authors in
// the last 90 days, from the git the repository already has. No address, name or commit
// leaves the machine, and nothing here can fail an upload: any problem drops the digest.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { ContributorDigest } from "@groundrule/spec";
import type { IO } from "./io.js";
import { call } from "./platform.js";

const execFileAsync = promisify(execFile);
export const CONTRIBUTOR_WINDOW_DAYS = 90;
const MAX_DIGESTS = 5000;

async function git(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** The workspace's salt, or undefined when the platform doesn't offer one (older platform). */
export async function contributorSalt(
  io: IO,
  upload: { url: string; token: string },
): Promise<string | undefined> {
  try {
    const r = await call<{ salt?: string }>(io, upload.url, "/v1/cli/contributors/salt", {
      token: upload.token,
    });
    return typeof r.salt === "string" && /^[0-9a-f]{32,128}$/.test(r.salt) ? r.salt : undefined;
  } catch {
    return undefined;
  }
}

export const digestOf = (salt: string, email: string) =>
  createHash("sha256").update(`${salt}:${email.trim().toLowerCase()}`).digest("hex");

/** Distinct authors on the default branch (or HEAD) in the window, hashed with the salt. */
export async function collectContributors(
  root: string,
  salt: string,
  now = new Date(),
): Promise<ContributorDigest | undefined> {
  const since = new Date(now.getTime() - CONTRIBUTOR_WINDOW_DAYS * 86_400_000);
  const ref = (await git(root, ["rev-parse", "--verify", "-q", "origin/HEAD"]))
    ? "origin/HEAD"
    : "HEAD";
  const log = await git(root, [
    "log",
    `--since=${since.toISOString()}`,
    "--format=%ae",
    "--no-merges",
    ref,
  ]);
  if (log === undefined) return undefined;
  const addresses = new Set<string>();
  for (const line of log.split("\n")) {
    const email = line.trim().toLowerCase();
    if (!email || email.endsWith("[bot]@users.noreply.github.com")) continue;
    addresses.add(email);
  }
  const shallow = (await git(root, ["rev-parse", "--is-shallow-repository"])) === "true";
  return {
    since: since.toISOString(),
    complete: !shallow,
    digests: [...addresses].slice(0, MAX_DIGESTS).map((e) => digestOf(salt, e)),
  };
}

/** The digest for an upload, or undefined when turned off, unsupported, or anything failed. */
export async function contributorsForUpload(
  io: IO,
  root: string,
  upload: { url: string; token: string },
  enabled: boolean,
): Promise<ContributorDigest | undefined> {
  if (!enabled) return undefined;
  const salt = await contributorSalt(io, upload);
  if (!salt) return undefined;
  return collectContributors(root, salt);
}
