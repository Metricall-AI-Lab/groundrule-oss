import { z } from "zod";
import { ApiVersion, Glob, Slug } from "./common.js";
import { Applicability } from "./standard.js";

export const Pack = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("Pack"),
    metadata: z.strictObject({
      id: Slug,
      title: z.string().min(1).max(120),
      description: z.string().min(1).optional(),
      owner: z.string().min(1).optional(),
      version: z
        .string()
        .regex(
          /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
          "Pack versions are semantic versions, e.g. 1.2.0",
        )
        .optional()
        .describe("Semantic version of the pack. Bump it whenever a standard changes."),
      tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Discovery tags, e.g. security, compliance, frontend."),
    }),
    spec: z.strictObject({
      include: z
        .array(Glob)
        .min(1)
        .default(["standards/**/*.yaml"])
        .describe("Standard files to include, relative to the pack file."),
      extends: z
        .array(z.string().min(1))
        .default([])
        .describe("Other packs this pack builds on. Same reference syntax as config extends."),
      applicability: Applicability.optional().describe(
        "Which repositories the pack is relevant to. Used for recommendations only.",
      ),
    }),
  })
  .describe("A reusable, named group of standards.");
export type Pack = z.infer<typeof Pack>;
