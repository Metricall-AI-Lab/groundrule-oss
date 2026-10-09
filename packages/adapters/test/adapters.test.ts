import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_VERSION, Standard } from "@groundrule/spec";
import { afterEach, describe, expect, it } from "vitest";
import {
  BEGIN,
  END,
  renderStandard,
  renderTargets,
  syncOutputs,
  upsertManagedBlock,
} from "../src/index.js";

const std = (
  id: string,
  severity: string,
  spec: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
) =>
  Standard.parse({
    apiVersion: API_VERSION,
    kind: "Standard",
    metadata: { id, title: `${id} title`, type: "requirement", ...metadata },
    spec: { severity, requirement: `Requirement of ${id}.`, ...spec },
  });

const standards = [
  std("SEC-1", "blocker"),
  std("STYLE-1", "advisory"),
  std("AUTH-17", "blocker", {
    scope: { paths: ["src/main/**"], languages: ["java"], frameworks: ["spring-boot"] },
    agent: { summary: "Authorize on the server before business logic." },
    examples: {
      approved: ["@PreAuthorize(...)"],
      forbidden: [
        { code: "@PostMapping\npublic X approve() {}", language: "java", note: "no check" },
      ],
    },
  }),
  std("HIDDEN-1", "warning", { agent: { instruction: false } }),
];

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), "groundrule-sync-"));
  dirs.push(d);
  return d;
}

describe("renderStandard", () => {
  it("writes a compact, agent-oriented entry with examples", () => {
    expect(renderStandard(standards[2] as Standard)).toBe(
      [
        "- **AUTH-17** AUTH-17 title · _blocker_",
        "  Authorize on the server before business logic. (java, spring-boot)",
        "  - Do: `@PreAuthorize(...)`",
        "  - Don't (no check):",
        "    ```java",
        "    @PostMapping",
        "    public X approve() {}",
        "    ```",
      ].join("\n"),
    );
  });
});

describe("renderTargets", () => {
  const outputs = renderTargets({
    standards,
    targets: ["agents-md", "claude-code", "cursor", "copilot"],
  });
  const byPath = Object.fromEntries(outputs.map((o) => [o.path, o]));

  it("groups by scope, blockers first, and leaves out non-agent standards", () => {
    const agents = byPath["AGENTS.md"]?.content ?? "";
    expect(agents).toContain("### Everywhere");
    expect(agents).toContain("### `src/main/**`");
    expect(agents.indexOf("SEC-1")).toBeLessThan(agents.indexOf("STYLE-1"));
    expect(agents.indexOf("STYLE-1")).toBeLessThan(agents.indexOf("AUTH-17"));
    expect(agents).not.toContain("HIDDEN-1");
    expect(agents).toContain("run `npx @groundrule/cli check`");
  });

  it("CLAUDE.md imports AGENTS.md instead of duplicating it", () => {
    expect(byPath["CLAUDE.md"]?.content).toContain("@AGENTS.md");
    expect(byPath["CLAUDE.md"]?.content).not.toContain("SEC-1");
    const solo = renderTargets({ standards, targets: ["claude-code"] });
    expect(solo[0]?.content).toContain("SEC-1");
  });

  it("writes Cursor rules: always-on for everywhere, globs for scoped", () => {
    const always = byPath[".cursor/rules/groundrule.mdc"]?.content ?? "";
    expect(always).toMatch(
      /^---\ndescription: Engineering standards for this repository\nglobs: \nalwaysApply: true\n---/,
    );
    const scoped = outputs.find((o) => o.path.startsWith(".cursor/rules/groundrule-src-main-"));
    expect(scoped?.content).toContain("globs: src/main/**\nalwaysApply: false");
    expect(scoped?.content).toContain("AUTH-17");
    expect(scoped?.content).not.toContain("SEC-1");
  });

  it("writes Copilot repository and path-specific instructions", () => {
    expect(byPath[".github/copilot-instructions.md"]?.content).toContain("SEC-1");
    const scoped = outputs.find((o) => o.path.startsWith(".github/instructions/groundrule-"));
    expect(scoped?.content).toMatch(/^---\napplyTo: "src\/main\/\*\*"\n---/);
  });

  it("is deterministic", () => {
    expect(renderTargets({ standards, targets: ["agents-md", "cursor"] })).toEqual(
      renderTargets({ standards: [...standards].reverse(), targets: ["agents-md", "cursor"] }),
    );
  });
});

describe("upsertManagedBlock", () => {
  it("creates, appends, and replaces only the managed block", () => {
    const created = upsertManagedBlock(undefined, "v1");
    expect(created.startsWith(BEGIN)).toBe(true);

    const appended = upsertManagedBlock("# My notes\n\nKeep me.\n", "v1");
    expect(appended).toMatch(/^# My notes\n\nKeep me\.\n\n<!-- groundrule:begin -->/);

    const replaced = upsertManagedBlock(`${appended}\n## After\n`, "v2");
    expect(replaced).toContain("Keep me.");
    expect(replaced).toContain("## After");
    expect(replaced).toContain("v2");
    expect(replaced).not.toContain("v1");
    expect(replaced.split(BEGIN)).toHaveLength(2);
    expect(replaced.split(END)).toHaveLength(2);
  });
});

describe("syncOutputs", () => {
  it("creates, reports unchanged, preserves hand-written content, and removes stale owned files", async () => {
    const root = await tmp();
    await writeFile(join(root, "AGENTS.md"), "# Team notes\n\nHand-written.\n");
    await mkdir(join(root, ".cursor/rules"), { recursive: true });
    await writeFile(join(root, ".cursor/rules/groundrule-old-abc12.mdc"), "stale");
    await writeFile(join(root, ".cursor/rules/team.mdc"), "not ours");

    const outputs = renderTargets({ standards, targets: ["agents-md", "cursor"] });
    const first = await syncOutputs(root, outputs, { targets: ["agents-md", "cursor"] });
    expect(first.map((c) => [c.path.replace(/-[a-z0-9]{5}\.mdc$/, "-*.mdc"), c.status])).toEqual([
      [".cursor/rules/groundrule-old-*.mdc", "removed"],
      [".cursor/rules/groundrule-src-main-*.mdc", "created"],
      [".cursor/rules/groundrule.mdc", "created"],
      ["AGENTS.md", "updated"],
    ]);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Hand-written.");
    expect(await readFile(join(root, ".cursor/rules/team.mdc"), "utf8")).toBe("not ours");

    const second = await syncOutputs(root, outputs, { targets: ["agents-md", "cursor"] });
    expect(second.every((c) => c.status === "unchanged")).toBe(true);
  });

  it("dry run reports without writing", async () => {
    const root = await tmp();
    const changes = await syncOutputs(root, renderTargets({ standards, targets: ["agents-md"] }), {
      dryRun: true,
    });
    expect(changes).toEqual([{ path: "AGENTS.md", status: "created" }]);
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).rejects.toThrow();
  });
});
