// Keyless signing with Sigstore (RFC 0009): in GitHub Actions the job's own identity signs the
// RFC 0008 payload through a short-lived certificate, recorded in Sigstore's public log. A
// verifier checks the bundle against Sigstore's trust root and then the policy: the signer
// must be a workflow of the run's own repository. No private key anywhere.

import type { CheckRun, CheckRunSigstoreSignature } from "@groundrule/spec";
import { sign as sigstoreSign, verify as sigstoreVerify } from "sigstore";
import { signingPayload } from "./signing.js";

/** The only identity issuer accepted today. */
export const GITHUB_ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";

export class SigstoreError extends Error {
  override name = "SigstoreError";
}

export interface SigstoreIdentity {
  issuer: string;
  subject: string;
}

/** True when this process runs in GitHub Actions with `permissions: id-token: write`. */
export function sigstoreAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

/**
 * The policy (RFC 0009): a GitHub Actions workflow of the run's own repository. The subject
 * looks like https://github.com/<owner>/<repo>/.github/workflows/<file>@<ref>.
 */
export function identityAllowed(identity: SigstoreIdentity, repositoryName: string): boolean {
  if (identity.issuer !== GITHUB_ACTIONS_ISSUER) return false;
  const prefix = `https://github.com/${repositoryName}/`;
  return (
    identity.subject.toLowerCase().startsWith(prefix.toLowerCase()) &&
    identity.subject.includes("/.github/workflows/")
  );
}

/** A readable form of a workflow identity: "acme/payments · groundrule.yml on refs/heads/main". */
export function describeIdentity(subject: string): {
  repository: string;
  workflow: string;
  ref: string;
} | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/\.github\/workflows\/([^@]+)@(.+)$/.exec(
    subject,
  );
  return m ? { repository: m[1] ?? "", workflow: m[2] ?? "", ref: m[3] ?? "" } : null;
}

/** Sign the run with the job's identity. Only in GitHub Actions; the run must be unsigned. */
export async function signWithSigstore(run: CheckRun, env?: NodeJS.ProcessEnv): Promise<CheckRun> {
  if (!sigstoreAvailable(env))
    throw new SigstoreError(
      "Keyless signing needs GitHub Actions with `permissions: id-token: write` on the job. Outside GitHub Actions, sign with a key (groundrule keys generate).",
    );
  const { signature: _signature, ...unsigned } = run;
  const payload = Buffer.from(signingPayload(unsigned as CheckRun), "utf8");
  let bundle: Awaited<ReturnType<typeof sigstoreSign>>;
  try {
    bundle = await sigstoreSign(payload);
  } catch (error) {
    throw new SigstoreError(
      `Sigstore couldn't sign the run: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  // Read the identity back from the bundle, so the recorded one is what verifiers will see.
  const signer = await sigstoreVerify(bundle, payload);
  const identity = identityOf(signer);
  if (!identity)
    throw new SigstoreError("Sigstore signed the run with a certificate that names no identity.");
  return {
    ...unsigned,
    signature: {
      algorithm: "sigstore",
      bundle: bundle as unknown as CheckRunSigstoreSignature["bundle"],
      identity,
    },
  };
}

function identityOf(signer: {
  identity?: { subjectAlternativeName?: string; extensions?: { issuer?: string } };
}) {
  const subject = signer.identity?.subjectAlternativeName;
  const issuer = signer.identity?.extensions?.issuer;
  return subject && issuer ? { issuer, subject } : null;
}

export type SigstoreVerification =
  | { ok: true; identity: SigstoreIdentity }
  | {
      ok: false;
      identity: SigstoreIdentity | null;
      reason: "unsigned" | "not-sigstore" | "invalid" | "identity-mismatch" | "policy";
      detail?: string;
    };

/**
 * Verify a Sigstore-signed run: the bundle against the trust root and the payload, then the
 * policy against the run's repository. Needs no key.
 */
export async function verifySigstoreRun(
  run: CheckRun,
  options: { tufCachePath?: string } = {},
): Promise<SigstoreVerification> {
  const signature = run.signature;
  if (!signature) return { ok: false, identity: null, reason: "unsigned" };
  if (signature.algorithm !== "sigstore")
    return { ok: false, identity: null, reason: "not-sigstore" };
  const payload = Buffer.from(signingPayload(run), "utf8");
  let found: SigstoreIdentity | null;
  try {
    const signer = await sigstoreVerify(
      signature.bundle as Parameters<typeof sigstoreVerify>[0],
      payload,
      {
        certificateIssuer: GITHUB_ACTIONS_ISSUER,
        ...(options.tufCachePath ? { tufCachePath: options.tufCachePath } : {}),
      },
    );
    found = identityOf(signer);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : undefined;
    return {
      ok: false,
      identity: signature.identity,
      reason: "invalid",
      ...(detail ? { detail } : {}),
    };
  }
  if (
    !found ||
    found.subject !== signature.identity.subject ||
    found.issuer !== signature.identity.issuer
  )
    return { ok: false, identity: found, reason: "identity-mismatch" };
  if (!identityAllowed(found, run.repository.name))
    return { ok: false, identity: found, reason: "policy" };
  return { ok: true, identity: found };
}
