import { defineEvaluator } from "@groundrule/core";
import picomatch from "picomatch";
import { z } from "zod";
import { Globs } from "./util.js";

const FileRule = z
  .strictObject({
    /** Files added, modified, renamed, or deleted. */
    changed: Globs.optional(),
    /** Files newly added. */
    added: Globs.optional(),
  })
  .refine((r) => r.changed || r.added, { message: "Set changed or added" });

const Options = z.strictObject({
  /** The rule applies when the change touches files matching this. */
  when: FileRule,
  /** ...and then the same change must also include files matching this. */
  require: FileRule,
  message: z.string().min(1).optional(),
});

export const changeSetEvaluator = defineEvaluator({
  id: "change-set",
  source: "deterministic",
  description: "Rules about the shape of a change, e.g. entity changes must include a migration.",
  optionsSchema: Options,
  supports(context) {
    return context.changes
      ? true
      : "Needs a change to compare. Run in a pull request or with --base.";
  },
  async evaluate({ options, context }) {
    const changes = context.changes ?? [];
    const matches = (rule: z.infer<typeof FileRule>) => {
      const changed = rule.changed ? picomatch(rule.changed, { dot: true }) : undefined;
      const added = rule.added ? picomatch(rule.added, { dot: true }) : undefined;
      return changes.filter(
        (c) => changed?.(c.path) || (added && c.status === "added" && added(c.path)),
      );
    };

    const triggers = matches(options.when);
    if (triggers.length === 0 || matches(options.require).length > 0) return [];

    const first = triggers[0];
    if (!first) return [];
    const wanted = [
      ...(options.require.changed ?? []).map((g) => `a change to ${g}`),
      ...(options.require.added ?? []).map((g) => `a new ${g}`),
    ].join(" or ");
    return [
      {
        status: "violation",
        confidence: "certain",
        message: options.message ?? `This change needs ${wanted}`,
        location: { file: first.path, startLine: first.changedLines[0]?.start ?? 1 },
        evidence: [`Changed: ${triggers.map((t) => t.path).join(", ")}`, `Missing: ${wanted}`],
        snippet: `change-set:${triggers.map((t) => t.path).join(",")}`,
      },
    ];
  },
});
