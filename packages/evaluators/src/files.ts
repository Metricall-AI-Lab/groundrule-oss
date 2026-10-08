import { defineEvaluator } from "@groundrule/core";
import picomatch from "picomatch";
import { z } from "zod";
import { Globs } from "./util.js";

const Options = z
  .strictObject({
    /** Each glob must match at least one file in the repository. */
    require: Globs.optional(),
    /** At least one of these globs must match a file. */
    requireAny: Globs.optional(),
    /** No file may match these globs. */
    forbid: Globs.optional(),
    /** Exempt files from `forbid`, e.g. .env.example. */
    allow: Globs.optional(),
    message: z.string().min(1).optional(),
  })
  .refine((o) => o.require || o.requireAny || o.forbid, {
    message: "Set at least one of require, requireAny, or forbid",
  });

export const filesEvaluator = defineEvaluator({
  id: "files",
  source: "deterministic",
  description: "Require or forbid files by path.",
  optionsSchema: Options,
  async evaluate({ options, context }) {
    const findings = [];
    const has = (glob: string) =>
      context.files.some((f) => picomatch.isMatch(f, glob, { dot: true }));

    for (const glob of options.require ?? []) {
      if (!has(glob)) {
        findings.push({
          status: "violation" as const,
          confidence: "certain" as const,
          message: options.message ?? `Required file is missing: ${glob}`,
          evidence: [`No file matches ${glob}`],
          snippet: `require:${glob}`,
        });
      }
    }

    if (options.requireAny && !options.requireAny.some(has)) {
      findings.push({
        status: "violation" as const,
        confidence: "certain" as const,
        message:
          options.message ?? `None of the required files exist: ${options.requireAny.join(", ")}`,
        evidence: options.requireAny.map((g) => `No file matches ${g}`),
        snippet: `requireAny:${options.requireAny.join(",")}`,
      });
    }

    if (options.forbid) {
      const forbidden = picomatch(options.forbid, { dot: true });
      const allowed = options.allow ? picomatch(options.allow, { dot: true }) : () => false;
      for (const file of context.targetFiles) {
        if (forbidden(file) && !allowed(file)) {
          findings.push({
            status: "violation" as const,
            confidence: "certain" as const,
            message: options.message ?? `This file is not allowed in the repository: ${file}`,
            location: { file, startLine: 1 },
            evidence: [`${file} matches forbidden pattern ${options.forbid.join(", ")}`],
            snippet: `forbid:${file}`,
          });
        }
      }
    }
    return findings;
  },
});
