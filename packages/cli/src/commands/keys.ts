// `groundrule keys`: a signing key pair for check runs (RFC 0008). The private key goes to a
// file only, never to stdout; the public key and its ID are printed so they can be registered.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateSigningKeys, keyIdOf, parsePublicKey, SigningError } from "@groundrule/core";
import { EXIT, eprintln, type IO, println, style } from "../io.js";

export const PRIVATE_FILE = "groundrule-signing.key";
export const PUBLIC_FILE = "groundrule-signing.pub";

export async function keysGenerate(io: IO, options: { out?: string }): Promise<number> {
  const dir = resolve(io.cwd, options.out ?? ".");
  const privateFile = join(dir, PRIVATE_FILE);
  const publicFile = join(dir, PUBLIC_FILE);
  for (const file of [privateFile, publicFile]) {
    if (existsSync(file)) {
      eprintln(io, `✕ ${file} exists already. Move it away, or choose another --out.`);
      return EXIT.usage;
    }
  }
  const keys = generateSigningKeys();
  await mkdir(dir, { recursive: true });
  await writeFile(privateFile, keys.privateKey, { mode: 0o600 });
  await writeFile(publicFile, keys.publicKey);
  const s = style(io);
  println(
    io,
    `${s.green("✓")} Wrote ${PRIVATE_FILE} (private, keep it secret) and ${PUBLIC_FILE}.`,
  );
  println(io);
  println(io, `  Key ID  ${keys.keyId}`);
  println(io);
  println(io, keys.publicKey.trimEnd());
  println(io);
  println(io, "Next:");
  println(
    io,
    `  1. Store the contents of ${PRIVATE_FILE} as the CI secret GROUNDRULE_SIGNING_KEY.`,
  );
  println(io, "     groundrule check --upload then signs every result.");
  println(io, "  2. Register the public key above in Groundrule: Settings → Signing keys.");
  println(
    io,
    `  3. Don't commit ${PRIVATE_FILE}. Add it to .gitignore, or move it out of the repository.`,
  );
  return EXIT.ok;
}

/** The ID of a public key, as a run and the workspace name it. */
export async function keysId(io: IO, file: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, file), "utf8");
  } catch {
    eprintln(io, `✕ Couldn't read ${file}.`);
    return EXIT.usage;
  }
  try {
    println(io, keyIdOf(parsePublicKey(text)));
  } catch (error) {
    if (!(error instanceof SigningError)) throw error;
    eprintln(io, `✕ ${error.message}`);
    return EXIT.usage;
  }
  return EXIT.ok;
}
