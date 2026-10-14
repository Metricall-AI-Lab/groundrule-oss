// Keyless signing (RFC 0009): the policy that ties a signer to the run's repository, the
// readable identity, and what happens outside GitHub Actions or with a bundle that doesn't
// verify. Real signing needs a GitHub Actions job; the hosted-test workflow covers that.
import { CheckRun } from "@groundrule/spec";
import { describe, expect, it } from "vitest";
import {
  describeIdentity,
  GITHUB_ACTIONS_ISSUER,
  generateSigningKeys,
  identityAllowed,
  parsePublicKey,
  SigstoreError,
  signWithSigstore,
  verifyCheckRun,
  verifySigstoreRun,
} from "../src/index.js";

const SUBJECT = "https://github.com/acme/payments/.github/workflows/groundrule.yml@refs/heads/main";

const run = (signature?: unknown): CheckRun =>
  CheckRun.parse({
    apiVersion: "groundrule.dev/v1alpha1",
    kind: "CheckRun",
    metadata: {
      generatedAt: "2026-10-14T10:00:00Z",
      cliVersion: "0.11.0",
      durationMs: 1,
      snippets: false,
    },
    repository: { name: "acme/payments", commit: "a".repeat(40) },
    mode: "changes",
    files: 1,
    changedFiles: 1,
    passed: true,
    failOn: "blocker",
    summary: {
      standards: 0,
      passed: 0,
      failed: 0,
      warned: 0,
      notEvaluable: 0,
      guidance: 0,
      skipped: 0,
      violations: 0,
      concerns: 0,
      suppressed: 0,
      legacy: 0,
      blocking: 0,
    },
    outcomes: [],
    findings: [],
    omittedFindings: 0,
    ...(signature ? { signature } : {}),
  });

const bogus = {
  algorithm: "sigstore",
  bundle: {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {},
    messageSignature: {},
  },
  identity: { issuer: GITHUB_ACTIONS_ISSUER, subject: SUBJECT },
};

describe("the Sigstore policy", () => {
  it("accepts only a GitHub Actions workflow of the run's own repository", () => {
    const id = (subject: string, issuer = GITHUB_ACTIONS_ISSUER) => ({ issuer, subject });
    expect(identityAllowed(id(SUBJECT), "acme/payments")).toBe(true);
    expect(identityAllowed(id(SUBJECT), "ACME/Payments")).toBe(true);
    expect(identityAllowed(id(SUBJECT), "acme/payments-api")).toBe(false);
    expect(identityAllowed(id(SUBJECT), "globex/payments")).toBe(false);
    expect(
      identityAllowed(
        id("https://github.com/acme/payments/other@refs/heads/main"),
        "acme/payments",
      ),
    ).toBe(false);
    expect(identityAllowed(id(SUBJECT, "https://gitlab.com"), "acme/payments")).toBe(false);
    expect(describeIdentity(SUBJECT)).toEqual({
      repository: "acme/payments",
      workflow: "groundrule.yml",
      ref: "refs/heads/main",
    });
    expect(describeIdentity("mailto:someone@example.com")).toBeNull();
  });

  it("refuses to sign outside GitHub Actions, and keeps key and keyless apart", async () => {
    await expect(signWithSigstore(run(), {})).rejects.toBeInstanceOf(SigstoreError);
    await expect(signWithSigstore(run(), {})).rejects.toThrow(/id-token: write/);
    expect(CheckRun.safeParse(run(bogus)).success).toBe(true);
    const keys = generateSigningKeys();
    expect(verifyCheckRun(run(bogus), parsePublicKey(keys.publicKey))).toEqual({
      ok: false,
      keyId: null,
      reason: "sigstore",
    });
    expect(await verifySigstoreRun(run())).toMatchObject({ ok: false, reason: "unsigned" });
  });

  it("rejects a bundle that doesn't verify", async () => {
    const v = await verifySigstoreRun(run(bogus));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("invalid");
  }, 30_000);
});
