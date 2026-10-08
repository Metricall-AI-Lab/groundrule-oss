import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  COMPLIANCE_FRAMEWORKS,
  compareRolloutStage,
  complianceFrameworkTitle,
  Pack,
  referenceLabel,
  referenceUrl,
  Standard,
} from "../src/index.js";

const minimal = {
  apiVersion: API_VERSION,
  kind: "Standard",
  metadata: { id: "SEC-001", title: "No private keys in the repository", type: "prohibition" },
  spec: { severity: "blocker", requirement: "Never commit private keys." },
};

const withSpec = (spec: Record<string, unknown>) => ({
  ...minimal,
  spec: { ...minimal.spec, ...spec },
});

describe("Standard catalog metadata (RFC 0001)", () => {
  it("keeps standards without the new fields valid", () => {
    const parsed = Standard.parse(minimal);
    expect(parsed.spec.compliance).toBeUndefined();
    expect(parsed.spec.rollout).toBeUndefined();
  });

  it("accepts the full set of catalog fields", () => {
    const parsed = Standard.parse(
      withSpec({
        references: [
          "https://example.com/adr/12",
          { id: "CWE-321", title: "Use of Hard-coded Cryptographic Key" },
          { title: "Internal runbook", url: "https://example.com/runbook" },
        ],
        compliance: [
          { framework: "soc2", controls: ["CC6.1"] },
          { framework: "iso-27001", controls: ["8.24", "5.17"] },
        ],
        applicability: {
          languages: ["java"],
          files: ["**/pom.xml"],
          dependencies: ["spring-boot"],
        },
        quality: { noise: "low", knownFalsePositives: ["Test fixtures with dummy keys"] },
        rollout: { recommendedStage: "enforce" },
      }),
    );
    expect(parsed.spec.references).toHaveLength(3);
    expect(parsed.spec.compliance?.[1]?.controls).toEqual(["8.24", "5.17"]);
    expect(parsed.spec.rollout?.recommendedStage).toBe("enforce");
  });

  it("still accepts plain URL references", () => {
    expect(Standard.safeParse(withSpec({ references: ["https://example.com"] })).success).toBe(
      true,
    );
  });

  it("rejects a reference with neither id nor url", () => {
    const result = Standard.safeParse(withSpec({ references: [{ title: "Somewhere" }] }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL string reference", () => {
    expect(Standard.safeParse(withSpec({ references: ["see the wiki"] })).success).toBe(false);
  });

  it("rejects compliance mappings without controls", () => {
    const result = Standard.safeParse(
      withSpec({ compliance: [{ framework: "soc2", controls: [] }] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("List at least one control ID, e.g. CC6.1");
  });

  it("rejects an unknown rollout stage and noise level", () => {
    expect(Standard.safeParse(withSpec({ rollout: { recommendedStage: "block" } })).success).toBe(
      false,
    );
    expect(Standard.safeParse(withSpec({ quality: { noise: "none" } })).success).toBe(false);
  });

  it("rejects unknown keys in the new objects", () => {
    expect(Standard.safeParse(withSpec({ applicability: { language: ["java"] } })).success).toBe(
      false,
    );
  });
});

describe("Pack catalog metadata (RFC 0001)", () => {
  const pack = {
    apiVersion: API_VERSION,
    kind: "Pack",
    metadata: { id: "java-spring", title: "Java and Spring Boot" },
    spec: {},
  };

  it("accepts version, tags, and applicability", () => {
    const parsed = Pack.parse({
      ...pack,
      metadata: { ...pack.metadata, version: "1.2.0", tags: ["backend"] },
      spec: { applicability: { files: ["**/pom.xml", "**/build.gradle*"] } },
    });
    expect(parsed.metadata.version).toBe("1.2.0");
    expect(parsed.spec.applicability?.files).toHaveLength(2);
  });

  it.each(["1", "1.2", "v1.2.0", "latest"])("rejects version %s", (version) => {
    expect(Pack.safeParse({ ...pack, metadata: { ...pack.metadata, version } }).success).toBe(
      false,
    );
  });

  it("accepts a pre-release version", () => {
    expect(
      Pack.safeParse({ ...pack, metadata: { ...pack.metadata, version: "2.0.0-beta.1" } }).success,
    ).toBe(true);
  });
});

describe("reference helpers", () => {
  it("derives CWE URLs and labels", () => {
    const ref = { id: "CWE-798", title: "Use of Hard-coded Credentials" };
    expect(referenceUrl(ref)).toBe("https://cwe.mitre.org/data/definitions/798.html");
    expect(referenceLabel(ref)).toBe("CWE-798 Use of Hard-coded Credentials");
  });

  it("prefers an explicit URL and passes plain URLs through", () => {
    expect(referenceUrl({ id: "CWE-1", url: "https://example.com/x" })).toBe(
      "https://example.com/x",
    );
    expect(referenceUrl("https://example.com")).toBe("https://example.com");
    expect(referenceLabel("https://example.com")).toBe("https://example.com");
  });

  it("returns no URL for unknown catalog IDs", () => {
    expect(referenceUrl({ id: "OWASP-A02:2021" })).toBeUndefined();
  });

  it("names known compliance frameworks", () => {
    expect(complianceFrameworkTitle("soc2")).toBe(COMPLIANCE_FRAMEWORKS.soc2?.title);
    expect(complianceFrameworkTitle("acme-policy")).toBe("acme-policy");
  });
});

describe("compareRolloutStage", () => {
  it("orders observe < teach < advise < enforce", () => {
    expect(compareRolloutStage("observe", "teach")).toBeLessThan(0);
    expect(compareRolloutStage("enforce", "advise")).toBeGreaterThan(0);
    expect(compareRolloutStage("teach", "teach")).toBe(0);
  });
});
