import { describe, expect, it } from "vitest";
import { formatDiagnostic, parseDocument } from "../src/index.js";

const header = "apiVersion: groundrule.dev/v1alpha1\n";

describe("parseDocument", () => {
  it("parses a valid standard", () => {
    const result = parseDocument(
      `${header}kind: Standard
metadata:
  id: DEP-008
  title: Use the platform HTTP client
  type: forbidden-tech
spec:
  severity: warning
  requirement: Use @acme/http-client.
`,
      "DEP-008.yaml",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.kind).toBe("Standard");
  });

  it("locates an invalid value on its line", () => {
    const result = parseDocument(
      `${header}kind: Standard
metadata:
  id: DEP-008
  title: Use the platform HTTP client
  type: forbidden-tech
spec:
  severity: critical
  requirement: Use @acme/http-client.
`,
      "DEP-008.yaml",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ path: "spec.severity", line: 8 });
  });

  it("points at the misspelled key itself", () => {
    const result = parseDocument(
      `${header}kind: Standard
metadata:
  id: DEP-008
  title: T
  type: requirement
spec:
  severity: warning
  requirment: Typo here.
`,
      "x.yaml",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unknown = result.diagnostics.find((d) => d.path === "spec.requirment");
    expect(unknown).toMatchObject({ line: 9, column: 3 });
  });

  it("reports YAML syntax errors with a position", () => {
    const result = parseDocument(`${header}kind: [unclosed\n`, "bad.yaml");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.line).toBeGreaterThan(0);
  });

  it("rejects duplicate keys", () => {
    const result = parseDocument(`${header}kind: Config\nkind: Config\n`, "dup.yaml");
    expect(result.ok).toBe(false);
  });

  it("reads a config that leaves out apiVersion and kind (RFC 0018)", () => {
    const short = parseDocument(
      "extends:\n  - groundrule:packs/essentials\ntargets:\n  - agents-md\n",
      ".groundrule/config.yaml",
      "Config",
    );
    expect(short.ok).toBe(true);
    if (short.ok) {
      expect(short.document.kind).toBe("Config");
      expect(short.document.apiVersion).toBe("groundrule.dev/v1alpha1");
      expect(short.document.enforcement.failOn).toBe("blocker");
    }
    // A wrong kind is still refused, and so is an unknown key.
    expect(parseDocument("kind: Standard\n", "config.yaml", "Config").ok).toBe(false);
    expect(parseDocument("extend: []\n", "config.yaml", "Config").ok).toBe(false);
    // Any other kind still has to say what it is.
    expect(parseDocument("metadata:\n  id: X-1\n", "x.yaml", "Standard").ok).toBe(false);
    // And the long form reads exactly as before.
    expect(parseDocument(`${header}kind: Config\n`, "config.yaml", "Config").ok).toBe(true);
  });

  it("enforces the expected kind", () => {
    const result = parseDocument(`${header}kind: Config\n`, "config.yaml", "Standard");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toContain('Expected kind "Standard"');
  });

  it("handles empty and non-mapping files", () => {
    expect(parseDocument("", "empty.yaml").ok).toBe(false);
    expect(parseDocument("- a\n- b\n", "list.yaml").ok).toBe(false);
  });

  it("formats diagnostics as file:line:col", () => {
    expect(
      formatDiagnostic({
        severity: "error",
        file: "a.yaml",
        line: 3,
        column: 5,
        path: "spec.severity",
        message: "Bad",
      }),
    ).toBe("a.yaml:3:5  spec.severity: Bad");
  });
});
