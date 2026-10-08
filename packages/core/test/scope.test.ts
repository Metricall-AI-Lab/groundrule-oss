import { describe, expect, it } from "vitest";
import { matchesScope } from "../src/index.js";

describe("matchesScope", () => {
  it("an empty scope matches everything", () => {
    expect(matchesScope({}, { path: "anything.ts", languages: ["go"] })).toBe(true);
  });

  it("matches path globs and honors excludes", () => {
    const scope = { paths: ["src/main/**"], exclude: ["src/main/generated/**"] };
    expect(matchesScope(scope, { path: "src/main/java/A.java" })).toBe(true);
    expect(matchesScope(scope, { path: "src/test/java/A.java" })).toBe(false);
    expect(matchesScope(scope, { path: "src/main/generated/A.java" })).toBe(false);
  });

  it("matches dotfiles", () => {
    expect(matchesScope({ paths: ["**/*.yml"] }, { path: ".github/workflows/ci.yml" })).toBe(true);
  });

  it("requires every declared field to match", () => {
    const scope = { languages: ["java"], frameworks: ["spring-boot"] };
    expect(matchesScope(scope, { languages: ["Java"], frameworks: ["spring-boot"] })).toBe(true);
    expect(matchesScope(scope, { languages: ["java"], frameworks: ["quarkus"] })).toBe(false);
  });

  it("unknown facts never exclude", () => {
    expect(matchesScope({ languages: ["java"], tags: ["backend"] }, { path: "a.java" })).toBe(true);
  });

  it("matches repository globs", () => {
    expect(matchesScope({ repositories: ["backend-*"] }, { repository: "backend-claims" })).toBe(
      true,
    );
    expect(matchesScope({ repositories: ["backend-*"] }, { repository: "web-app" })).toBe(false);
  });
});
