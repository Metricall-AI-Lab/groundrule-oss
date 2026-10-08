import { describe, expect, it } from "vitest";
import { formatSourceRef, parseSourceRef, SourceRefError } from "../src/index.js";

describe("parseSourceRef", () => {
  it.each([
    ["./packs/security", { type: "local", path: "./packs/security" }],
    ["../shared", { type: "local", path: "../shared" }],
    ["github:acme/standards", { type: "github", owner: "acme", repo: "standards", path: "" }],
    [
      "github:acme/engineering-standards//packs/security@v3",
      {
        type: "github",
        owner: "acme",
        repo: "engineering-standards",
        path: "packs/security",
        ref: "v3",
      },
    ],
    ["groundrule:packs/java-spring", { type: "registry", name: "packs/java-spring" }],
    [
      "groundrule:packs/java-spring@1.2.0",
      { type: "registry", name: "packs/java-spring", version: "1.2.0" },
    ],
  ])("parses %s", (input, expected) => {
    expect(parseSourceRef(input)).toEqual(expected);
  });

  it.each(["https://example.com/x", "packs/security", "github:acme", "groundrule:Packs/X", ""])(
    "rejects %s",
    (input) => {
      expect(() => parseSourceRef(input)).toThrow(SourceRefError);
    },
  );

  it("round-trips through formatSourceRef", () => {
    for (const input of [
      "./packs/a",
      "github:acme/standards//packs/security@v3",
      "groundrule:packs/java-spring@1.2.0",
    ]) {
      expect(formatSourceRef(parseSourceRef(input))).toBe(input);
    }
  });
});
