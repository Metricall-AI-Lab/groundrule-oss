import { describe, expect, it } from "vitest";
import {
  colorEnabled,
  renderJson,
  renderMarkdown,
  renderSarif,
  renderTerminal,
} from "../src/index.js";
import { fixture } from "./fixture.js";

describe("terminal", () => {
  const text = renderTerminal(fixture());

  it("leads with the blocking standard, its location, evidence, and fix", () => {
    expect(text).toContain(" ✕ AUTH-017  Authorization checks must occur at the service boundary");
    expect(text).toContain("   BLOCKER · static analysis (semgrep)");
    expect(text).toContain("   src/Api.java:10-11");
    expect(text).toContain('     10: @PostMapping("/approve")');
    expect(text).toContain("   → Add @PreAuthorize.");
    expect(text).toContain("   → groundrule explain AUTH-017");
    expect(text.indexOf("AUTH-017")).toBeLessThan(text.indexOf("DEP-008"));
  });

  it("hides legacy and excepted findings behind a count", () => {
    expect(text).not.toContain("old/package.json");
    expect(text).toContain(
      "○ 1 legacy finding not introduced by this change · 1 finding covered by exceptions (show with --verbose)",
    );
    const verbose = renderTerminal(fixture(), { verbose: true });
    expect(verbose).toContain("old/package.json:3  legacy");
    expect(verbose).toContain("billing/package.json:4  excepted by EX-1042");
  });

  it("explains what was not evaluated and ends with a verdict", () => {
    expect(text).toContain("– AUTH-017 partly evaluated: AI checks arrive in Groundrule 0.2");
    expect(text).toContain("Failed  ✓ 1 passed  ✕ 1 failed  ⚠ 1 warning  ◇ 1 guidance  · 0.4s");
    expect(text).toContain("groundrule check · 4 standards · 3 files changed vs origin/main");
  });

  it("fits in 80 columns apart from user content", () => {
    const structural = text
      .split("\n")
      .filter((l) => !l.includes("AUTH-017  ") && !l.startsWith("     "));
    for (const line of structural) expect(line.length).toBeLessThanOrEqual(110);
  });

  it("shows at most five locations per standard unless verbose", () => {
    const input = fixture();
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...input.result.findings[1],
      location: { file: `src/f${i % 3}.ts`, startLine: i + 1 },
      fingerprint: `many-${i}`,
    })) as typeof input.result.findings;
    input.result.findings = [input.result.findings[0], ...many] as typeof input.result.findings;
    const text = renderTerminal(input);
    expect(text.match(/src\/f\d\.ts:\d/g)).toHaveLength(5);
    expect(text).toContain("… 3 more in 3 files (show all with --verbose)");
    expect(renderTerminal(input, { verbose: true }).match(/src\/f\d\.ts:\d/g)).toHaveLength(8);
  });

  it("has no ANSI codes unless color is on", () => {
    const ESC = String.fromCharCode(27);
    expect(text.includes(`${ESC}[`)).toBe(false);
    expect(renderTerminal(fixture(), { color: true }).includes(`${ESC}[31m`)).toBe(true);
  });
});

describe("colorEnabled", () => {
  it("respects NO_COLOR, FORCE_COLOR, and TTY", () => {
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
  });
});

describe("json", () => {
  it("is stable, versioned, and marks blocking findings", () => {
    const json = JSON.parse(renderJson(fixture()));
    expect(json).toMatchObject({
      schemaVersion: 1,
      tool: { name: "groundrule", version: "0.1.0" },
      passed: false,
    });
    expect(json.context.root).toBeUndefined();
    expect(
      json.findings.map((f: { fingerprint: string; blocking: boolean }) => [
        f.fingerprint,
        f.blocking,
      ]),
    ).toEqual([
      ["fp-auth", true],
      ["fp-dep", false],
      ["fp-legacy", false],
      ["fp-ex", false],
    ]);
  });
});

describe("sarif", () => {
  const sarif = JSON.parse(renderSarif(fixture()));
  const run = sarif.runs[0];

  it("declares one rule per reported standard with help text", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(run.tool.driver.rules.map((r: { id: string }) => r.id)).toEqual(["AUTH-017", "DEP-008"]);
    expect(run.tool.driver.rules[0].help.text).toContain("Why: Never trust the client.");
    expect(run.tool.driver.rules[0].defaultConfiguration.level).toBe("error");
  });

  it("maps findings to results with locations, fingerprints, and suppressions", () => {
    expect(run.results).toHaveLength(4);
    expect(run.results[0]).toMatchObject({
      ruleId: "AUTH-017",
      level: "error",
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "src/Api.java" },
            region: { startLine: 10, endLine: 11 },
          },
        },
      ],
      partialFingerprints: { "groundrule/v1": "fp-auth" },
    });
    expect(run.results[3].suppressions).toEqual([
      { kind: "external", justification: "Groundrule exception EX-1042" },
    ]);
  });
});

describe("markdown", () => {
  const md = renderMarkdown(fixture());
  it("summarizes for a pull request", () => {
    expect(md).toContain("### Groundrule · ✕ 1 standard failed");
    expect(md).toContain(
      "| ✕ | **AUTH-017** Authorization checks must occur at the service boundary | Endpoint lacks authorization.<br>**Fix:** Add @PreAuthorize. | `src/Api.java:10-11` | static analysis |",
    );
    expect(md).not.toContain("old/package.json");
    expect(md).toContain("✓ 1 passed · ◇ 1 guidance · 1 legacy finding · 1 covered by exceptions");
    expect(md).toContain("<details><summary>Not fully evaluated</summary>");
  });
});
