// `groundrule verify`: check a run's signature offline with a public key (RFC 0008). Exit 0
// when it verifies, 1 when it doesn't, 2 when the inputs can't be read.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parsePublicKey, SigningError, verifyCheckRun } from "@groundrule/core";
import { CheckRun } from "@groundrule/spec";
import { EXIT, eprintln, type IO, println, style } from "../io.js";

export async function verify(io: IO, file: string, options: { key: string }): Promise<number> {
  const read = async (path: string, what: string) => {
    try {
      return await readFile(resolve(io.cwd, path), "utf8");
    } catch {
      eprintln(io, `✕ Couldn't read ${what} at ${path}.`);
      return undefined;
    }
  };
  const text = await read(file, "the run");
  const keyText = await read(options.key, "the public key");
  if (text === undefined || keyText === undefined) return EXIT.usage;

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
  let key: ReturnType<typeof parsePublicKey>;
  try {
    key = parsePublicKey(keyText);
  } catch (error) {
    if (!(error instanceof SigningError)) throw error;
    eprintln(io, `✕ ${error.message}`);
    return EXIT.usage;
  }

  const s = style(io);
  const r = run.data;
  const result = verifyCheckRun(r, key);
  const about = [
    `  Repository  ${r.repository.name}${r.repository.commit ? ` @ ${r.repository.commit.slice(0, 12)}` : ""}`,
    r.pullRequest ? `  Pull request  #${r.pullRequest.number}` : undefined,
    `  Result  ${r.passed ? "passed" : "failed"} · ${r.summary.blocking} blocking · ${r.outcomes.length} standards`,
    r.rulebook ? `  Rulebook  ${r.rulebook.digest} (${r.rulebook.standards} rules)` : undefined,
  ].filter((l): l is string => Boolean(l));
  if (result.ok) {
    println(io, `${s.green("✓")} Signature verified: signed with key ${result.keyId}.`);
    for (const l of about) println(io, l);
    return EXIT.ok;
  }
  const why = {
    unsigned: "The run isn't signed.",
    "wrong-key": `The run was signed with key ${result.keyId}, not the key given.`,
    invalid: "The signature doesn't match the run: it was altered after signing, or forged.",
  }[result.reason];
  println(io, `${s.red("✕")} Not verified. ${why}`);
  for (const l of about) println(io, l);
  return EXIT.failed;
}
