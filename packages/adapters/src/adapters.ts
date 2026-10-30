import type { ActionPolicy, AgentTarget, Standard } from "@groundrule/spec";
import { CODERABBIT_FILE, mergeCodeRabbit, renderCodeRabbit } from "./coderabbit.js";
import {
  groupByScope,
  PREAMBLE,
  renderActions,
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
  /**
   * managed: a marked block in a file that may hold other content.
   * owned:   the whole file.
   * merged:  entries inside a structured file; `merge` folds them into what's there.
   */
  mode: "managed" | "owned" | "merged";
  merge?: (existing: string | undefined) => string;
}

export interface AdapterInput {
  /** Effective standards to deliver to agents, already filtered for this repository. */
  standards: readonly Standard[];
  /** Action policies to deliver (RFC 0017): what the agent may not do alone. */
  actions?: readonly ActionPolicy[];
  targets: readonly AgentTarget[];
}

/** Patterns of owned files a target may have generated before; stale ones are removed on sync. */
export const OWNED_PATTERNS: Partial<Record<AgentTarget, { dir: string; match: RegExp }>> = {
  cursor: { dir: ".cursor/rules", match: /^groundrule(-[a-z0-9-]+)?\.mdc$/ },
  copilot: { dir: ".github/instructions", match: /^groundrule-[a-z0-9-]+\.instructions\.md$/ },
};

export function renderTargets(input: AdapterInput): OutputFile[] {
  const standards = input.standards.filter((s) => s.spec.agent.instruction);
  const actions = (input.actions ?? []).filter((a) => a.spec.agent.instruction);
  const outputs: OutputFile[] = [];
  for (const target of new Set(input.targets)) {
    switch (target) {
      case "agents-md":
        outputs.push({
          path: "AGENTS.md",
          mode: "managed",
          content: renderStandardsDocument(standards, 2, actions),
        });
        break;
      case "claude-code":
        outputs.push({
          path: "CLAUDE.md",
          mode: "managed",
          // Claude Code follows @imports; don't spend context on a second copy.
          content: input.targets.includes("agents-md")
            ? "Engineering standards for this repository are in AGENTS.md:\n\n@AGENTS.md"
            : renderStandardsDocument(standards, 2, actions),
        });
        break;
      case "cursor":
        outputs.push(...renderCursor(standards, actions));
        break;
      case "copilot":
        outputs.push(...renderCopilot(standards, actions));
        break;
      case "coderabbit": {
        const entries = renderCodeRabbit(standards);
        outputs.push({
          path: CODERABBIT_FILE,
          mode: "merged",
          content: mergeCodeRabbit(undefined, entries),
          merge: (existing) => mergeCodeRabbit(existing, entries),
        });
        break;
      }
    }
  }
  return outputs;
}

function renderCursor(
  standards: readonly Standard[],
  actions: readonly ActionPolicy[],
): OutputFile[] {
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
      ...(everywhere && actions.length ? [renderActions(actions, 2), ""] : []),
    ];
    return {
      path: `.cursor/rules/${everywhere ? "groundrule.mdc" : `groundrule-${scopeSlug(group)}.mdc`}`,
      mode: "owned" as const,
      content: `${[...frontmatter, ...body].join("\n").trimEnd()}\n`,
    };
  });
}

function renderCopilot(
  standards: readonly Standard[],
  actions: readonly ActionPolicy[],
): OutputFile[] {
  const groups = groupByScope(standards);
  const everywhere = groups.find((g) => g.key === "");
  const outputs: OutputFile[] = [
    {
      path: ".github/copilot-instructions.md",
      mode: "managed",
      content: renderStandardsDocument(everywhere?.standards ?? [], 2, actions),
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
