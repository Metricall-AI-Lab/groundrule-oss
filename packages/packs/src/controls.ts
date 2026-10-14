// Names for the compliance controls the catalog maps rules to, so a report can show "CC8.1
// Change management" rather than an ID. A mapping means following the rule contributes
// evidence for the control; it never satisfies the control by itself. Frameworks the
// catalog uses without names here (owasp-asvs, pci-dss, hipaa) are shown by ID.

export const COMPLIANCE_FRAMEWORK_NAMES: Record<string, string> = {
  soc2: "SOC 2 (2017 Trust Services Criteria)",
  "iso-27001": "ISO/IEC 27001:2022, Annex A",
  "owasp-asvs": "OWASP ASVS 4.0",
  "pci-dss": "PCI DSS 4.0",
  hipaa: "HIPAA Security Rule",
};

/** Control names, by framework. Wording follows the published criteria, shortened. */
export const COMPLIANCE_CONTROLS: Record<string, Record<string, string>> = {
  soc2: {
    "CC6.1": "Logical access security: credentials, keys and access to protected information",
    "CC6.6": "Boundary protection against external threats",
    "CC6.7": "Protection of information in transmission",
    "CC6.8": "Prevention of unauthorized or malicious software",
    "CC7.1": "Detection of configuration changes and vulnerabilities",
    "CC7.2": "Monitoring for anomalies and security events",
    "CC8.1": "Change management: authorized, tested and reviewed changes",
    "A1.2": "Availability: recovery, capacity and resilience",
  },
  "iso-27001": {
    "5.15": "Access control",
    "5.17": "Authentication information",
    "8.3": "Information access restriction",
    "8.5": "Secure authentication",
    "8.6": "Capacity management",
    "8.8": "Management of technical vulnerabilities",
    "8.9": "Configuration management",
    "8.11": "Data masking",
    "8.12": "Data leakage prevention",
    "8.15": "Logging",
    "8.19": "Installation of software on operational systems",
    "8.20": "Networks security",
    "8.24": "Use of cryptography",
    "8.25": "Secure development life cycle",
    "8.26": "Application security requirements",
    "8.27": "Secure system architecture and engineering principles",
    "8.28": "Secure coding",
    "8.29": "Security testing in development and acceptance",
    "8.31": "Separation of development, test and production environments",
    "8.32": "Change management",
  },
};
