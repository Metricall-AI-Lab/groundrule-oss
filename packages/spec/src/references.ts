import type { Reference } from "./standard.js";

/** Well-known compliance frameworks, keyed by the `framework` ID used in mappings. */
export const COMPLIANCE_FRAMEWORKS: Readonly<Record<string, { title: string; url: string }>> = {
  soc2: {
    title: "SOC 2 (Trust Services Criteria)",
    url: "https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services",
  },
  "iso-27001": { title: "ISO/IEC 27001:2022 Annex A", url: "https://www.iso.org/standard/27001" },
  "owasp-asvs": {
    title: "OWASP Application Security Verification Standard 4.0",
    url: "https://owasp.org/www-project-application-security-verification-standard/",
  },
  "pci-dss": { title: "PCI DSS v4.0", url: "https://www.pcisecuritystandards.org/" },
  hipaa: {
    title: "HIPAA Security Rule (45 CFR 164)",
    url: "https://www.hhs.gov/hipaa/for-professionals/security/index.html",
  },
  "nist-ssdf": {
    title: "NIST Secure Software Development Framework (SP 800-218)",
    url: "https://csrc.nist.gov/projects/ssdf",
  },
};

/** The display title of a compliance framework, or its ID when unknown. */
export function complianceFrameworkTitle(framework: string): string {
  return COMPLIANCE_FRAMEWORKS[framework]?.title ?? framework;
}

/** A URL for a reference: its own URL, or one derived from a well-known catalog ID. */
export function referenceUrl(ref: Reference): string | undefined {
  if (typeof ref === "string") return ref;
  if (ref.url) return ref.url;
  const cwe = ref.id?.match(/^CWE-(\d+)$/);
  return cwe ? `https://cwe.mitre.org/data/definitions/${cwe[1]}.html` : undefined;
}

/** A one-line label for a reference, e.g. "CWE-798 Use of Hard-coded Credentials". */
export function referenceLabel(ref: Reference): string {
  if (typeof ref === "string") return ref;
  return [ref.id, ref.title].filter(Boolean).join(" ") || (ref.url ?? "");
}
