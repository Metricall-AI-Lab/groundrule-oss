import type { AgentTarget, Standard } from "@groundrule/spec";
import {
  groupByScope,
  PREAMBLE,
  renderStandard,
  renderStandardsDocument,
  SOURCE_NOTE,
  scopeHeading,
  scopeSlug,
} from "./render.js";

/**
 * managed: Groundrule owns only a marked block inside a file that may contain other content.
 * owned:   Groundrule owns the whole file.
 */
export interface OutputFile {
  path: string;
  content: string;
  mode: "managed" | "owned";
}

export interface AdapterInput {
  /** Effective standards to deliver to agents, already filtered for this repository. */
  standards: readonly Standard[];
  targets: readonly AgentTarget[];
}

/** Patterns of owned files a target may have generated before; stale ones are removed on sync. */
export const OWNED_PATTERNS: Partial<Record<AgentTarget, { dir: string; match: RegExp }>> = {
  cursor: { dir: ".cursor/rules", match: /^groundrule(-[a-z0-9-]+)?\.mdc$/ },
  copilot: { dir: ".github/instructions", match: /^groundrule-[a-z0-9-]+\.instructions\.md$/ },
};

export function renderTargets(input: AdapterInput): OutputFile[] {
  const standards = input.standards.filter((s) => s.spec.agent.instruction);
  const outputs: OutputFile[] = [];
  for (const target of new Set(input.targets)) {
    switch (target) {
      case "agents-md":
        outputs.push({
          path: "AGENTS.md",
          mode: "managed",
          content: renderStandardsDocument(standards),
        });
        break;
      case "claude-code":
        outputs.push({
          path: "CLAUDE.md",
          mode: "managed",
          // Claude Code follows @imports; don't spend context on a second copy.
          content: input.targets.includes("agents-md")
            ? "Engineering standards for this repository are in AGENTS.md:\n\n@AGENTS.md"
            : renderStandardsDocument(standards),
        });
        break;
      case "cursor":
        outputs.push(...renderCursor(standards));
        break;
      case "copilot":
        outputs.push(...renderCopilot(standards));
        break;
    }
  }
  return outputs;
}

function renderCursor(standards: readonly Standard[]): OutputFile[] {
  return groupByScope(standards).map((group) => {
    const everywhere = group.key === "";
    const frontmatter = [
      "---",
      `description: ${everywhere ? "Engineering standards for this repository" : `Engineering standards for ${group.paths.join(", ")}`}`,
      `globs: ${everywhere ? "" : group.paths.join(",")}`,
      `alwaysApply: ${everywhere}`,
      "---",
    ];
    const body = [
      `<!-- ${SOURCE_NOTE} -->`,
      "",
      `# Engineering standards: ${scopeHeading(group)}`,
      "",
      PREAMBLE,
      "",
      ...group.standards.flatMap((s) => [renderStandard(s), ""]),
    ];
    return {
      path: `.cursor/rules/${everywhere ? "groundrule.mdc" : `groundrule-${scopeSlug(group)}.mdc`}`,
      mode: "owned" as const,
      content: `${[...frontmatter, ...body].join("\n").trimEnd()}\n`,
    };
  });
}

function renderCopilot(standards: readonly Standard[]): OutputFile[] {
  const groups = groupByScope(standards);
  const everywhere = groups.find((g) => g.key === "");
  const outputs: OutputFile[] = [
    {
      path: ".github/copilot-instructions.md",
      mode: "managed",
      content: renderStandardsDocument(everywhere?.standards ?? []),
    },
  ];
  for (const group of groups.filter((g) => g.key !== "")) {
    outputs.push({
      path: `.github/instructions/groundrule-${scopeSlug(group)}.instructions.md`,
      mode: "owned",
      content: [
        "---",
        `applyTo: "${group.paths.join(",")}"`,
        "---",
        "",
        `<!-- ${SOURCE_NOTE} -->`,
        "",
        `# Engineering standards: ${scopeHeading(group)}`,
        "",
        PREAMBLE,
        "",
        ...group.standards.flatMap((s) => [renderStandard(s), ""]),
      ]
        .join("\n")
        .trimEnd()
        .concat("\n"),
    });
  }
  return outputs;
}
