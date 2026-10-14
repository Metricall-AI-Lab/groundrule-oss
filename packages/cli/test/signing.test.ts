// `groundrule keys`, `check --sign` and `groundrule verify` (RFC 0008), end to end: a key pair
// on disk, a signed run written by check, verified offline, and refused once altered.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const standard = {
  apiVersion: "groundrule.dev/v1alpha1",
  kind: "Standard",
  metadata: { id: "PAY-001", title: "Cents", type: "prohibition", category: "payments" },
  spec: {
    severity: "blocker",
    requirement: "Money as integer cents.",
    checks: [
      { evaluator: "regex", pattern: "amount \\* 1\\.0", include: ["src/**"], message: "float" },
    ],
  },
};

describe("signed check runs", () => {
  it("generates keys, signs a run with the secret, and verifies it offline", async () => {
    const repo = await tmp("gr-sign-");
    await mkdir(join(repo, ".groundrule/standards"), { recursive: true });
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, ".groundrule/config.yaml"),
      "apiVersion: groundrule.dev/v1alpha1\nkind: Config\n",
    );
    await writeFile(join(repo, ".groundrule/standards/PAY-001.yaml"), JSON.stringify(standard));
    await writeFile(join(repo, "src/a.ts"), "export const t = (amount: number) => amount * 1.0;\n");

    const keysDir = await tmp("gr-keys-");
    const gen = await cli(repo, {}, "keys", "generate", "--out", keysDir);
    expect(gen.code).toBe(0);
    expect(gen.stdout).toContain("Key ID  sha256:");
    expect(gen.stdout).toContain("-----BEGIN PUBLIC KEY-----");
    expect(gen.stdout).not.toContain("PRIVATE KEY");
    expect((await stat(join(keysDir, "groundrule-signing.key"))).mode & 0o777).toBe(0o600);
    // Not twice.
    expect((await cli(repo, {}, "keys", "generate", "--out", keysDir)).code).toBe(2);
    const keyId = (
      await cli(repo, {}, "keys", "id", join(keysDir, "groundrule-signing.pub"))
    ).stdout.trim();
    expect(gen.stdout).toContain(keyId);

    // --sign without a key is an error; with the secret, the run is signed; --no-sign isn't.
    const out = join(await tmp("gr-out-"), "run.json");
    expect(
      (
        await cli(
          repo,
          {},
          "check",
          "--all",
          "--sign",
          "--repository",
          "acme/payments",
          "--write-check-run",
          out,
        )
      ).stderr,
    ).toContain("--sign needs GROUNDRULE_SIGNING_KEY");
    const secret = await readFile(join(keysDir, "groundrule-signing.key"), "utf8");
    const env = { GROUNDRULE_SIGNING_KEY: secret };
    expect(
      (
        await cli(
          repo,
          env,
          "check",
          "--all",
          "--repository",
          "acme/payments",
          "--write-check-run",
          out,
        )
      ).code,
    ).toBe(1);
    const signed = JSON.parse(await readFile(out, "utf8"));
    expect(signed.signature).toMatchObject({ algorithm: "ed25519", keyId });
    expect(
      (
        await cli(
          repo,
          env,
          "check",
          "--all",
          "--no-sign",
          "--repository",
          "acme/payments",
          "--write-check-run",
          out,
        )
      ).code,
    ).toBe(1);
    expect(JSON.parse(await readFile(out, "utf8")).signature).toBeUndefined();
    // The base64 of the PEM works too.
    const b64 = { GROUNDRULE_SIGNING_KEY: Buffer.from(secret).toString("base64") };
    expect(
      (
        await cli(
          repo,
          b64,
          "check",
          "--all",
          "--repository",
          "acme/payments",
          "--write-check-run",
          out,
        )
      ).code,
    ).toBe(1);
    expect(JSON.parse(await readFile(out, "utf8")).signature.keyId).toBe(keyId);
    expect(
      (await cli(repo, { GROUNDRULE_SIGNING_KEY: "nope" }, "check", "--all")).stderr,
    ).toContain("isn't a PEM private key");

    // Verify: the signed run, then the same run with one finding moved.
    await writeFile(out, JSON.stringify(signed));
    const pub = join(keysDir, "groundrule-signing.pub");
    const ok = await cli(repo, {}, "verify", out, "--key", pub);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain(`Signature verified: signed with key ${keyId}`);
    expect(ok.stdout).toContain("Repository  acme");
    signed.findings[0].line = 99;
    await writeFile(out, JSON.stringify(signed));
    const bad = await cli(repo, {}, "verify", out, "--key", pub);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain("altered after signing, or forged");
    const other = await tmp("gr-keys2-");
    await cli(repo, {}, "keys", "generate", "--out", other);
    const wrong = await cli(
      repo,
      {},
      "verify",
      out,
      "--key",
      join(other, "groundrule-signing.pub"),
    );
    expect(wrong.code).toBe(1);
    expect(wrong.stdout).toContain(`signed with key ${keyId}, not the key given`);
    expect((await cli(repo, {}, "verify", "missing.json", "--key", pub)).code).toBe(2);
  });
});
