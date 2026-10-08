import { describe, expect, it } from "vitest";
import { API_VERSION, Config } from "../src/index.js";

describe("Config", () => {
  it("fills safe defaults from a minimal config", () => {
    const parsed = Config.parse({ apiVersion: API_VERSION, kind: "Config" });
    expect(parsed.extends).toEqual([]);
    expect(parsed.targets).toEqual(["agents-md"]);
    expect(parsed.enforcement).toEqual({
      scope: "changed-lines",
      legacy: "report",
      failOn: "blocker",
    });
  });

  it("validates extends references", () => {
    const ok = Config.safeParse({
      apiVersion: API_VERSION,
      kind: "Config",
      extends: [
        "./packs/security",
        "github:acme/standards//packs/backend@v3",
        "groundrule:packs/java-spring",
      ],
    });
    expect(ok.success).toBe(true);

    const bad = Config.safeParse({
      apiVersion: API_VERSION,
      kind: "Config",
      extends: ["https://example.com/pack.yaml"],
    });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown agent targets", () => {
    const result = Config.safeParse({ apiVersion: API_VERSION, kind: "Config", targets: ["vim"] });
    expect(result.success).toBe(false);
  });

  it("keys overrides by standard id", () => {
    const ok = Config.safeParse({
      apiVersion: API_VERSION,
      kind: "Config",
      overrides: { "ARCH-014": { severity: "advisory", reason: "Legacy service" } },
    });
    expect(ok.success).toBe(true);
    const bad = Config.safeParse({
      apiVersion: API_VERSION,
      kind: "Config",
      overrides: { "not-an-id": { disabled: true } },
    });
    expect(bad.success).toBe(false);
  });
});
