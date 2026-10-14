import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_VERSION, Standard } from "@groundrule/spec";
import { afterEach, describe, expect, it } from "vitest";
import {
  BEGIN,
  END,
  hasCodeRabbitEntries,
  MAX_CUSTOM_CHECKS,
  mergeCodeRabbit,
  renderCodeRabbit,
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

describe("CodeRabbit (RFC 0010)", () => {
  const rules = [
    ...standards,
    std("LOG-1", "warning", { checks: [{ evaluator: "llm", prompt: "Logs must not hold PII." }] }),
    std("CHK-1", "blocker", { checks: [{ evaluator: "regex", pattern: "x" }] }),
    std("ADV-1", "advisory"),
  ];

  it("writes path instructions per scope and advisory checks for rules no check covers", () => {
    const { pathInstructions, customChecks } = renderCodeRabbit(
      rules.filter((s) => s.spec.agent.instruction),
    );
    expect(pathInstructions.map((p) => p.path)).toEqual(["**", "src/main/**"]);
    expect(pathInstructions[0]?.instructions).toMatch(
      /^\[groundrule\] Engineering standards for Everywhere/,
    );
    expect(pathInstructions[0]?.instructions).toContain(
      "SEC-1 (blocker) SEC-1 title: Requirement of SEC-1.",
    );
    expect(pathInstructions[1]?.instructions).toContain("Do: @PreAuthorize(...)");
    expect(pathInstructions[1]?.instructions).toContain(
      "Don't: @PostMapping public X approve() {}",
    );
    // Blockers and warnings without a deterministic check, highest first; never ADV-1 or CHK-1.
    expect(customChecks.map((c) => c.name)).toEqual([
      "Groundrule AUTH-17",
      "Groundrule SEC-1",
      "Groundrule LOG-1",
    ]);
    expect(customChecks.every((c) => c.mode === "warning")).toBe(true);
    expect(customChecks[0]?.instructions).toContain("Pass/fail criteria: Requirement of AUTH-17.");
    expect(customChecks[0]?.instructions).toContain("Only files matching src/main/** count.");
    // At most five.
    const many = Array.from({ length: 9 }, (_, i) => std(`M-${i}`, "warning"));
    expect(renderCodeRabbit(many).customChecks).toHaveLength(MAX_CUSTOM_CHECKS);
  });

  it("merges into a file the team owns, replacing only its own entries, and removes them cleanly", () => {
    const theirs = `# our settings
language: en-US
reviews:
  profile: chill
  path_instructions:
    - path: "docs/**"
      instructions: "Check spelling." # ours
  pre_merge_checks:
    custom_checks:
      - name: "Ticket link"
        mode: "error"
        instructions: "Pass if the PR links a ticket."
`;
    const entries = renderCodeRabbit(rules);
    const merged = mergeCodeRabbit(theirs, entries);
    expect(merged).toContain("# our settings");
    expect(merged).toContain("profile: chill");
    expect(merged).toContain('Check spelling." # ours');
    expect(merged).toContain("Ticket link");
    expect(merged.match(/\[groundrule\]/g)?.length).toBe(
      entries.pathInstructions.length + entries.customChecks.length,
    );
    // Syncing again replaces, never duplicates.
    const again = mergeCodeRabbit(merged, entries);
    expect(again).toBe(merged);
    // Fewer rules next time: stale Groundrule entries go, theirs stay.
    const fewer = mergeCodeRabbit(merged, renderCodeRabbit([std("ONLY-1", "advisory")]));
    expect(fewer.match(/\[groundrule\]/g)?.length).toBe(1);
    expect(fewer).toContain("Check spelling.");
    // Target dropped: only the team's entries remain, and empty sections aren't left behind.
    const gone = mergeCodeRabbit(merged, null);
    expect(gone).not.toContain("[groundrule]");
    expect(gone).toContain("Check spelling.");
    expect(gone).toContain("Ticket link");
    const emptied = mergeCodeRabbit(mergeCodeRabbit(undefined, entries), null);
    expect(emptied.startsWith("# yaml-language-server: $schema=")).toBe(true);
    expect(emptied).not.toContain("[groundrule]");
    expect(emptied.trim().endsWith("{}")).toBe(true);
    // A new file carries the schema line and the note.
    const fresh = mergeCodeRabbit(undefined, entries);
    expect(fresh.startsWith("# yaml-language-server: $schema=")).toBe(true);
    expect(fresh).toContain("generated by Groundrule");
    expect(hasCodeRabbitEntries(fresh)).toBe(true);
    expect(hasCodeRabbitEntries(theirs)).toBe(false);
  });

  it("syncs .coderabbit.yaml alongside the other targets, and cleans up when the target goes", async () => {
    const root = await tmp();
    await writeFile(join(root, ".coderabbit.yaml"), "reviews:\n  profile: assertive\n");
    const outputs = renderTargets({ standards: rules, targets: ["agents-md", "coderabbit"] });
    const first = await syncOutputs(root, outputs, { targets: ["agents-md", "coderabbit"] });
    expect(first.find((c) => c.path === ".coderabbit.yaml")?.status).toBe("updated");
    const text = await readFile(join(root, ".coderabbit.yaml"), "utf8");
    expect(text).toContain("profile: assertive");
    expect(text).toContain("[groundrule]");
    const second = await syncOutputs(root, outputs, { targets: ["agents-md", "coderabbit"] });
    expect(second.find((c) => c.path === ".coderabbit.yaml")?.status).toBe("unchanged");
    // --check reports drift without writing.
    await writeFile(
      join(root, ".coderabbit.yaml"),
      text.replace("profile: assertive", "profile: chill"),
    );
    const dry = await syncOutputs(root, outputs, {
      dryRun: true,
      targets: ["agents-md", "coderabbit"],
    });
    expect(dry.find((c) => c.path === ".coderabbit.yaml")?.status).toBe("unchanged");
    // Only agents-md now: Groundrule's entries leave, the team's setting stays.
    const removed = await syncOutputs(
      root,
      renderTargets({ standards: rules, targets: ["agents-md"] }),
      {
        targets: ["agents-md"],
      },
    );
    expect(removed.find((c) => c.path === ".coderabbit.yaml")?.status).toBe("updated");
    const after = await readFile(join(root, ".coderabbit.yaml"), "utf8");
    expect(after).toContain("profile: chill");
    expect(after).not.toContain("[groundrule]");
  });
});
