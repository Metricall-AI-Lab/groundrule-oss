// Signed check runs (RFC 0008): a signature survives what a receiver may do to snippets, and
// catches any other change; keys round-trip through PEM and base64.
import { CheckRun, type CheckRunKeySignature } from "@groundrule/spec";
import { describe, expect, it } from "vitest";
import {
  generateSigningKeys,
  keyIdOf,
  parsePrivateKey,
  parsePublicKey,
  signCheckRun,
  signingPayload,
  verifyCheckRun,
} from "../src/index.js";

const run = (): CheckRun =>
  CheckRun.parse({
    apiVersion: "groundrule.dev/v1alpha1",
    kind: "CheckRun",
    metadata: {
      generatedAt: "2026-10-14T10:00:00Z",
      cliVersion: "0.10.0",
      durationMs: 1,
      snippets: true,
    },
    repository: { name: "acme/payments", commit: "a".repeat(40) },
    mode: "changes",
    files: 2,
    changedFiles: 1,
    passed: false,
    failOn: "blocker",
    summary: {
      standards: 1,
      passed: 0,
      failed: 1,
      warned: 0,
      notEvaluable: 0,
      guidance: 0,
      skipped: 0,
      violations: 1,
      concerns: 0,
      suppressed: 0,
      legacy: 0,
      blocking: 1,
    },
    outcomes: [
      {
        id: "PAY-001",
        title: "Cents",
        severity: "blocker",
        status: "failed",
        violations: 1,
        concerns: 0,
      },
    ],
    findings: [
      {
        standardId: "PAY-001",
        severity: "blocker",
        status: "violation",
        source: "deterministic",
        blocking: true,
        isNew: true,
        file: "src/a.ts",
        line: 3,
        message: "Float money",
        snippet: "const total = amount * 1.0;",
      },
    ],
    omittedFindings: 0,
  });

describe("signing a run", () => {
  it("verifies with the public key, and names it", () => {
    const keys = generateSigningKeys();
    const signed = signCheckRun(run(), parsePrivateKey(keys.privateKey));
    expect(signed.signature).toMatchObject({ algorithm: "ed25519", keyId: keys.keyId });
    expect(CheckRun.safeParse(signed).success).toBe(true);
    expect(verifyCheckRun(signed, parsePublicKey(keys.publicKey))).toEqual({
      ok: true,
      keyId: keys.keyId,
    });
    expect(keyIdOf(keys.publicKey)).toBe(keys.keyId);
    expect(keys.keyId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("survives redacted or dropped snippets, and nothing else", () => {
    const keys = generateSigningKeys();
    const pub = parsePublicKey(keys.publicKey);
    const signed = signCheckRun(run(), parsePrivateKey(keys.privateKey));
    const redacted: CheckRun = {
      ...signed,
      findings: signed.findings.map((f) => ({ ...f, snippet: "[redacted]" })),
    };
    expect(verifyCheckRun(redacted, pub).ok).toBe(true);
    const dropped: CheckRun = {
      ...signed,
      findings: signed.findings.map(({ snippet: _s, ...f }) => f),
    };
    expect(verifyCheckRun(dropped, pub).ok).toBe(true);
    expect(signingPayload(dropped)).toBe(signingPayload(signed));

    const passed: CheckRun = { ...signed, passed: true };
    expect(verifyCheckRun(passed, pub)).toEqual({
      ok: false,
      keyId: keys.keyId,
      reason: "invalid",
    });
    const moved: CheckRun = {
      ...signed,
      findings: signed.findings.map((f) => ({ ...f, line: 4 })),
    };
    expect(verifyCheckRun(moved, pub).ok).toBe(false);
    const forged: CheckRun = {
      ...signed,
      signature: {
        ...(signed.signature as CheckRunKeySignature),
        value: `${"A".repeat(86)}==`,
      },
    };
    expect(verifyCheckRun(forged, pub)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("tells an unsigned run and another key apart", () => {
    const a = generateSigningKeys();
    const b = generateSigningKeys();
    expect(verifyCheckRun(run(), parsePublicKey(a.publicKey))).toEqual({
      ok: false,
      keyId: null,
      reason: "unsigned",
    });
    const signed = signCheckRun(run(), parsePrivateKey(a.privateKey));
    expect(verifyCheckRun(signed, parsePublicKey(b.publicKey))).toEqual({
      ok: false,
      keyId: a.keyId,
      reason: "wrong-key",
    });
  });

  it("reads a private key as PEM or as its base64, and refuses other keys", () => {
    const keys = generateSigningKeys();
    const fromBase64 = parsePrivateKey(Buffer.from(keys.privateKey).toString("base64"));
    const signed = signCheckRun(run(), fromBase64);
    expect(verifyCheckRun(signed, parsePublicKey(keys.publicKey)).ok).toBe(true);
    expect(() => parsePrivateKey("not a key")).toThrow(/isn't a PEM private key/);
    expect(() => parsePublicKey(keys.privateKey)).toThrow(/That's a private key/);
    expect(() => parsePublicKey("nope")).toThrow(/isn't a PEM public key/);
  });
});
