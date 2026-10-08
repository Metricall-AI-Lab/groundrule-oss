import { z } from "zod";
import { ApiVersion, Glob, Slug } from "./common.js";

export const Pack = z
  .strictObject({
    apiVersion: ApiVersion,
    kind: z.literal("Pack"),
    metadata: z.strictObject({
      id: Slug,
      title: z.string().min(1).max(120),
      description: z.string().min(1).optional(),
      owner: z.string().min(1).optional(),
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
    }),
  })
  .describe("A reusable, named group of standards.");
export type Pack = z.infer<typeof Pack>;
