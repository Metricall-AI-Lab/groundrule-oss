// `check --sigstore` and `verify` on keyless runs (RFC 0009), as far as a test can go without
// a GitHub Actions job: the guard rails, and verification of a run that doesn't verify.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSigningKeys } from "@groundrule/core";
import { afterEach, describe, expect, it } from "vitest";
import { type IO, run } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmp(prefix: string) {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function cli(cwd: string, env: Record<string, string>, ...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const io: IO = {
    cwd,
    env: { NO_COLOR: "1", ...env },
    stdout: {
      write: (t: string) => {
        stdout += t;
      },
    },
    stderr: {
      write: (t: string) => {
        stderr += t;
      },
    },
    fetch: (async () => {
      throw new Error("network access attempted");
    }) as unknown as typeof fetch,
    configDir: join(cwd, ".no-credentials"),
  };
  return { code: await run(argv, io), stdout, stderr };
}

describe("keyless signing in the CLI", () => {
  it("needs GitHub Actions, and never both a key and Sigstore", async () => {
    const repo = await tmp("gr-sigstore-");
    await mkdir(join(repo, ".groundrule"), { recursive: true });
    await writeFile(
      join(repo, ".groundrule/config.yaml"),
      "apiVersion: groundrule.dev/v1alpha1\nkind: Config\n",
    );
    const out = join(await tmp("gr-out-"), "run.json");
    const outside = await cli(repo, {}, "check", "--all", "--sigstore", "--write-check-run", out);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain("needs GitHub Actions with `permissions: id-token: write`");

    const keys = generateSigningKeys();
    const both = await cli(
      repo,
      {
        GROUNDRULE_SIGNING_KEY: keys.privateKey,
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://x",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t",
      },
      "check",
      "--all",
      "--sigstore",
    );
    expect(both.code).toBe(2);
    expect(both.stderr).toContain("Choose one");

    // A key-signed run needs its key; a Sigstore run that doesn't verify is refused.
    await cli(
      repo,
      { GROUNDRULE_SIGNING_KEY: keys.privateKey },
      "check",
      "--all",
      "--write-check-run",
      out,
    );
    const keyed = await cli(repo, {}, "verify", out);
    expect(keyed.code).toBe(2);
    expect(keyed.stderr).toContain("pass its public key with --key");

    const doc = JSON.parse(await readFile(out, "utf8"));
    doc.signature = {
      algorithm: "sigstore",
      bundle: { mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" },
      identity: {
        issuer: "https://token.actions.githubusercontent.com",
        subject:
          "https://github.com/acme/payments/.github/workflows/groundrule.yml@refs/heads/main",
      },
    };
    await writeFile(out, JSON.stringify(doc));
    const bad = await cli(repo, {}, "verify", out);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain("The Sigstore bundle doesn't verify");
  }, 60_000);
});
