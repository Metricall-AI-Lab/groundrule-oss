import { describe, expect, it } from "vitest";
import { isGeneratedFile, isGroundruleDocument, stripManagedBlocks } from "../src/index.js";

describe("generated content", () => {
  it("recognizes files Groundrule owns", () => {
    expect(isGeneratedFile(".cursor/rules/groundrule.mdc")).toBe(true);
    expect(isGeneratedFile(".cursor/rules/groundrule-src-main-abc12.mdc")).toBe(true);
    expect(isGeneratedFile(".github/instructions/groundrule-src-ab1.instructions.md")).toBe(true);
    expect(isGeneratedFile(".cursor/rules/team.mdc")).toBe(false);
    expect(isGeneratedFile("AGENTS.md")).toBe(false);
  });

  it("blanks managed blocks but keeps line numbers and hand-written content", () => {
    const text =
      "# Notes\nrejectUnauthorized: false\n<!-- groundrule:begin -->\nrejectUnauthorized: false\n<!-- groundrule:end -->\nafter\n";
    const stripped = stripManagedBlocks(text);
    expect(stripped.split("\n")).toEqual([
      "# Notes",
      "rejectUnauthorized: false",
      "",
      "",
      "",
      "after",
      "",
    ]);
  });

  it("recognizes Groundrule documents anywhere in a repository", () => {
    expect(
      isGroundruleDocument(
        "standards/SEC-004.yaml",
        "# c\napiVersion: groundrule.dev/v1alpha1\nkind: Standard\n",
      ),
    ).toBe(true);
    expect(isGroundruleDocument("k8s/deploy.yaml", "apiVersion: apps/v1\nkind: Deployment\n")).toBe(
      false,
    );
    expect(isGroundruleDocument("notes.md", "apiVersion: groundrule.dev/v1alpha1\n")).toBe(false);
  });
});
