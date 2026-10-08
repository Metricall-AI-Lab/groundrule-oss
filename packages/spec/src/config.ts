import { z } from "zod";
import { ApiVersion, Glob, Severity, StandardId } from "./common.js";
import { isValidSourceRef } from "./source-ref.js";

/** Agent instruction formats the adapters can generate. */
export const AGENT_TARGETS = ["agents-md", "claude-code", "cursor", "copilot"] as const;
export const AgentTarget = z.enum(AGENT_TARGETS);
export type AgentTarget = z.infer<typeof AgentTarget>;

export const Enforcement = z.strictObject({
  scope: z
    .enum(["changed-lines", "changed-files", "all"])
    .default("changed-lines")
    .describe("Which code is evaluated by `check`."),
  legacy: z
    .enum(["report", "ignore", "enforce"])
    .default("report")
    .describe("How pre-existing (baseline) violations are treated."),
  failOn: z
    .enum(["blocker", "warning", "none"])
    .default("blocker")
    .describe("Lowest severity that makes `check` exit non-zero."),
});
export type Enforcement = z.infer<typeof Enforcement>;

export const StandardOverride = z.strictObject({
  severity: Severity.optional(),
  disabled: z.boolean().optional(),
  reason: z.string().min(1).optional(),
});
export type StandardOverride = z.infer<typeof StandardOverride>;

export const Config = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("Config"),
    extends: z
      .array(
        z.string().refine(isValidSourceRef, {
          message: "Use ./path, github:owner/repo//path[@ref], or groundrule:packs/name[@version]",
        }),
      )
      .default([])
      .describe("Packs or standard directories this repository inherits."),
    standards: z
      .array(Glob)
      .default(["standards/**/*.yaml"])
      .describe("Repository-local standard files, relative to the .groundrule directory."),
    tags: z
      .array(z.string().min(1))
      .default([])
      .describe("Repository tags matched by standard scopes, e.g. multi-tenant."),
    targets: z.array(AgentTarget).default(["agents-md"]).describe("Agent formats to generate."),
    enforcement: Enforcement.default({
      scope: "changed-lines",
      legacy: "report",
      failOn: "blocker",
    }),
    overrides: z.record(StandardId, StandardOverride).default({}),
  })
  .describe("Repository configuration, stored at .groundrule/config.yaml.");
export type Config = z.infer<typeof Config>;
export type ConfigInput = z.input<typeof Config>;
