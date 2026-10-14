// `groundrule verify`: check a run's signature offline with a public key (RFC 0008). Exit 0
// when it verifies, 1 when it doesn't, 2 when the inputs can't be read.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  describeIdentity,
  parsePublicKey,
  SigningError,
  verifyCheckRun,
  verifySigstoreRun,
} from "@groundrule/core";
import { CheckRun } from "@groundrule/spec";
import { EXIT, eprintln, type IO, println, style } from "../io.js";

export async function verify(io: IO, file: string, options: { key?: string }): Promise<number> {
  const read = async (path: string, what: string) => {
    try {
      return await readFile(resolve(io.cwd, path), "utf8");
    } catch {
      eprintln(io, `✕ Couldn't read ${what} at ${path}.`);
      return undefined;
    }
  };
  const text = await read(file, "the run");
  if (text === undefined) return EXIT.usage;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    eprintln(io, `✕ ${file} isn't JSON.`);
    return EXIT.usage;
  }
  const run = CheckRun.safeParse(parsed);
  if (!run.success) {
    eprintln(io, `✕ ${file} isn't a CheckRun this CLI understands (upgrade @groundrule/cli?).`);
    return EXIT.usage;
  }
  const s = style(io);
  const r = run.data;
  const about = [
    `  Repository  ${r.repository.name}${r.repository.commit ? ` @ ${r.repository.commit.slice(0, 12)}` : ""}`,
    r.pullRequest ? `  Pull request  #${r.pullRequest.number}` : undefined,
    `  Result  ${r.passed ? "passed" : "failed"} · ${r.summary.blocking} blocking · ${r.outcomes.length} standards`,
    r.rulebook ? `  Rulebook  ${r.rulebook.digest} (${r.rulebook.standards} rules)` : undefined,
  ].filter((l): l is string => Boolean(l));

  // Keyless (RFC 0009): the trust root and the policy, no key needed.
  if (r.signature?.algorithm === "sigstore") {
    const v = await verifySigstoreRun(r);
    const who = (id: { subject: string } | null) => {
      const d = id && describeIdentity(id.subject);
      return d ? `${d.repository} · ${d.workflow} on ${d.ref}` : (id?.subject ?? "unknown");
    };
    if (v.ok) {
      println(
        io,
        `${s.green("✓")} Signature verified (Sigstore): signed by GitHub Actions, ${who(v.identity)}.`,
      );
      for (const l of about) println(io, l);
      return EXIT.ok;
    }
    const why = {
      unsigned: "The run isn't signed.",
      "not-sigstore": "The run isn't Sigstore-signed.",
      invalid: `The Sigstore bundle doesn't verify${v.detail ? `: ${v.detail}` : "."}`,
      "identity-mismatch": `The certificate names ${who(v.identity)}, not the identity the run claims.`,
      policy: `Signed by ${who(v.identity)}, which isn't a workflow of ${r.repository.name}.`,
    }[v.reason];
    println(io, `${s.red("✕")} Not verified. ${why}`);
    for (const l of about) println(io, l);
    return EXIT.failed;
  }

  if (!options.key) {
    eprintln(io, "✕ This run is signed with a key: pass its public key with --key <file>.");
    return EXIT.usage;
  }
  const keyText = await read(options.key, "the public key");
  if (keyText === undefined) return EXIT.usage;
  let key: ReturnType<typeof parsePublicKey>;
  try {
    key = parsePublicKey(keyText);
  } catch (error) {
    if (!(error instanceof SigningError)) throw error;
    eprintln(io, `✕ ${error.message}`);
    return EXIT.usage;
  }
  const result = verifyCheckRun(r, key);
  if (result.ok) {
    println(io, `${s.green("✓")} Signature verified: signed with key ${result.keyId}.`);
    for (const l of about) println(io, l);
    return EXIT.ok;
  }
  const why = {
    unsigned: "The run isn't signed.",
    "wrong-key": `The run was signed with key ${result.keyId}, not the key given.`,
    invalid: "The signature doesn't match the run: it was altered after signing, or forged.",
    sigstore: "The run is Sigstore-signed.",
  }[result.reason];
  println(io, `${s.red("✕")} Not verified. ${why}`);
  for (const l of about) println(io, l);
  return EXIT.failed;
}
