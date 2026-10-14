// Signed check runs (RFC 0008): Ed25519 over the canonical JSON of a run without its
// `signature` and without snippets, so a run can be proven unaltered offline with the public
// key. Keys are PEM (PKCS#8 private, SPKI public); a key's ID is sha256: of its raw 32 bytes.
// Nothing here reads the environment or the network.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import type { CheckRun, CheckRunSignature } from "@groundrule/spec";
import { canonicalJson } from "./compliance.js";

export interface SigningKeys {
  /** PKCS#8 PEM. Keep it secret. */
  privateKey: string;
  /** SPKI PEM. Register this one. */
  publicKey: string;
  keyId: string;
}

/** The public key's raw 32 bytes, from an SPKI key, as sha256:… */
export function keyIdOf(publicKey: KeyObject | string): string {
  const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  const jwk = key.export({ format: "jwk" });
  if (key.asymmetricKeyType !== "ed25519" || typeof jwk.x !== "string")
    throw new SigningError("The key isn't an Ed25519 public key.");
  const raw = Buffer.from(jwk.x, "base64url");
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

export function generateSigningKeys(): SigningKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    keyId: keyIdOf(publicKey),
  };
}

export class SigningError extends Error {
  override name = "SigningError";
}

/** A private key from a secret: PEM, or the base64 of a PEM for systems without multi-line secrets. */
export function parsePrivateKey(secret: string): KeyObject {
  const text = secret.trim();
  const pem = text.startsWith("-----")
    ? text
    : Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new SigningError(
      "The signing key isn't a PEM private key (or the base64 of one). Generate one with `groundrule keys generate`.",
    );
  }
  if (key.asymmetricKeyType !== "ed25519")
    throw new SigningError("The signing key isn't an Ed25519 key.");
  return key;
}

export function parsePublicKey(text: string): KeyObject {
  // Node would derive the public key from a private one; that is never what was meant here.
  if (/PRIVATE KEY/.test(text))
    throw new SigningError(
      "That's a private key. Use the public key (groundrule-signing.pub), and keep the private one secret.",
    );
  let key: KeyObject;
  try {
    key = createPublicKey(text.trim());
  } catch {
    throw new SigningError("That isn't a PEM public key.");
  }
  if (key.asymmetricKeyType !== "ed25519")
    throw new SigningError("The public key isn't an Ed25519 key.");
  return key;
}

/** What is signed: the run without `signature`, and without any finding's snippet. */
export function signingPayload(run: CheckRun): string {
  const { signature: _signature, ...rest } = run;
  return canonicalJson({
    ...rest,
    findings: run.findings.map(({ snippet: _snippet, ...f }) => f),
  });
}

export function signCheckRun(run: CheckRun, privateKey: KeyObject): CheckRun {
  const signature: CheckRunSignature = {
    algorithm: "ed25519",
    keyId: keyIdOf(createPublicKey(privateKey)),
    value: sign(null, Buffer.from(signingPayload(run), "utf8"), privateKey).toString("base64"),
  };
  return { ...run, signature };
}

export type Verification =
  | { ok: true; keyId: string }
  | { ok: false; keyId: string | null; reason: "unsigned" | "wrong-key" | "invalid" | "sigstore" };

/**
 * Check a run's signature against one public key. `wrong-key` means the run names another
 * key; `invalid` means the signature doesn't match the run (altered, or forged).
 */
export function verifyCheckRun(run: CheckRun, publicKey: KeyObject): Verification {
  const signature = run.signature;
  if (!signature) return { ok: false, keyId: null, reason: "unsigned" };
  // A Sigstore signature is verified by identity, not by a key: see verifySigstoreRun.
  if (signature.algorithm !== "ed25519") return { ok: false, keyId: null, reason: "sigstore" };
  const keyId = keyIdOf(publicKey);
  if (signature.keyId !== keyId) return { ok: false, keyId: signature.keyId, reason: "wrong-key" };
  let ok = false;
  try {
    ok = verify(
      null,
      Buffer.from(signingPayload(run), "utf8"),
      publicKey,
      Buffer.from(signature.value, "base64"),
    );
  } catch {
    ok = false;
  }
  return ok ? { ok: true, keyId } : { ok: false, keyId, reason: "invalid" };
}
