import { appliesToRepository, inspectRepository } from "@groundrule/core";
import { createServer, type Tool } from "@groundrule/mcp";
import { compareSeverity } from "@groundrule/spec";
import { EXIT, eprintln, type IO, VERSION } from "../io.js";
import { PlatformError } from "../platform.js";
import { openWorkspace } from "../workspace.js";
import { Proposal, sendProposal } from "./propose.js";

const INSTRUCTIONS = `Groundrule holds this team's engineering standards. Call list_standards to see the rules in effect before writing or reviewing code, and follow them. When the developer corrects you about how code in this codebase should be written and says, or confirms when you ask, that it should apply to everyone from now on, call propose_rule so the team can adopt it. Never propose one-off preferences, rules that already exist, or anything the developer didn't ask for or agree to.`;

/** A short, stable name for the agent, from what its MCP client calls itself. */
const agentName = (name: string | undefined) =>
  name
    ?.toLowerCase()
    .replace(/[^a-z0-9 ._-]/g, "")
    .trim()
    .slice(0, 60) || undefined;

/** How each rollout stage changes what `groundrule check` does with a rule's findings. */
const STAGE_NOTE: Record<string, string> = {
  advise: "advise: findings warn, never fail",
  enforce: "enforce",
  teach: "teach: guidance only",
};

export function groundruleTools(io: IO): Tool[] {
  const listStandards: Tool = {
    name: "list_standards",
    title: "List engineering standards",
    description:
      "List the engineering standards in effect in this repository: ID, title, severity, rollout stage for organization rules, and what each requires. Follow every rule listed; at advise, checks report findings as warnings, and at enforce they fail at the rule's severity. Also use it to check whether a rule already exists before proposing one.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Only standards whose ID, title, or requirement contain these words.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args) {
      const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
      const workspace = await openWorkspace(io, { use: "all" });
      if (!workspace)
        return {
          text: "This repository has no Groundrule configuration, or it couldn't be loaded. Run `groundrule doctor`.",
          isError: true,
        };
      const repo = await inspectRepository(workspace);
      const rows = workspace.standards
        .filter((l) => !l.disabled && l.standard.metadata.status === "active")
        .filter((l) => appliesToRepository(l.standard, repo))
        .map((l) => ({
          id: l.standard.metadata.id,
          title: l.standard.metadata.title,
          severity: l.standard.spec.severity,
          ...(l.stage ? { stage: l.stage } : {}),
          requirement: (l.standard.spec.agent?.summary ?? l.standard.spec.requirement)
            .replace(/\s+/g, " ")
            .trim(),
          ...(l.standard.spec.scope.paths?.length ? { paths: l.standard.spec.scope.paths } : {}),
        }))
        .filter(
          (r) =>
            !query ||
            query
              .split(/\s+/)
              .every((w) => `${r.id} ${r.title} ${r.requirement}`.toLowerCase().includes(w)),
        )
        .sort((a, b) => compareSeverity(b.severity, a.severity) || a.id.localeCompare(b.id));
      const text = rows.length
        ? rows
            .map(
              (r) =>
                `${r.id} (${r.severity}${r.stage ? ` · ${STAGE_NOTE[r.stage] ?? r.stage}` : ""}) ${r.title}: ${r.requirement}${r.paths ? ` [applies to ${r.paths.join(", ")}]` : ""}`,
            )
            .join("\n")
        : query
          ? `No standards match "${query}".`
          : "No standards are in effect in this repository.";
      return { text, structured: { standards: rows } };
    },
  };

  const proposeRule: Tool = {
    name: "propose_rule",
    title: "Propose a rule to the team",
    description:
      "Propose an engineering rule for this team's Groundrule rulebook, for reviewers to accept or reject. Use it when the developer corrects how code here should be written and says, or confirms when you ask, that it should apply to everyone from now on (for example: \"we never call Stripe directly, use PaymentsGateway\"). Do not use it for one-off preferences, for rules list_standards already shows, or without the developer's agreement. Write the rule as one clear sentence. Tell the developer you proposed it and that a reviewer decides.",
    inputSchema: {
      type: "object",
      properties: {
        rule: {
          type: "string",
          description: "The rule, as one clear sentence: what to do or never do.",
        },
        why: { type: "string", description: "Why, in the developer's words, if they said." },
        example: {
          type: "string",
          description: "A short code example of the right or wrong way, if helpful.",
        },
        file: { type: "string", description: "Repository-relative path where it came up, if any." },
        line: { type: "integer", minimum: 1, description: "Line in that file, if any." },
      },
      required: ["rule"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(args, { client }) {
      const parsed = Proposal.safeParse(args);
      if (!parsed.success)
        return {
          text: `Not proposed: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`,
          isError: true,
        };
      try {
        const agent = agentName(client?.name);
        const res = await sendProposal(io, parsed.data, "mcp", agent ? { agent } : {});
        const similar = res.similar.length
          ? ` Similar existing rules: ${res.similar.map((m) => m.id).join(", ")}.`
          : "";
        const text =
          res.status === "rejected"
            ? `Not proposed: reviewers in ${res.org.name} already rejected this rule. Tell the developer; they can ask a reviewer to reopen it.`
            : res.duplicate
              ? `Already proposed in ${res.org.name}; this was added to it. A reviewer decides.${similar}`
              : `Proposed to ${res.org.name}. A reviewer will accept or reject it in the Groundrule inbox (${res.url}).${similar}`;
        return { text, structured: { ...res } };
      } catch (error) {
        if (error instanceof PlatformError)
          return { text: `Not proposed: ${error.message}`, isError: true };
        throw error;
      }
    },
  };

  return [listStandards, proposeRule];
}

/** `groundrule mcp`: serve Groundrule to a coding agent over stdio (Model Context Protocol). */
export async function mcp(io: IO): Promise<number> {
  if (!io.stdin) {
    eprintln(
      io,
      "✕ groundrule mcp needs standard input; run it from your coding agent's MCP settings.",
    );
    return EXIT.usage;
  }
  // stdout carries the protocol; everything else goes to stderr.
  const quiet: IO = { ...io, stdout: io.stderr };
  const server = createServer({
    name: "groundrule",
    version: VERSION,
    instructions: INSTRUCTIONS,
    tools: groundruleTools(quiet),
    log: (m) => eprintln(io, m),
  });
  const stdin = io.stdin;
  const out = io.stdout;
  await server.serve(stdin, { write: (t: string) => out.write(t) });
  return EXIT.ok;
}

export const _test = { agentName };
