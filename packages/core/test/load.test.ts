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
