// Inputs for a hosted check (ADR 0029 in the backend repository): Groundrule's worker runs
// `groundrule check` in a sandbox with no network and no git, and hands over everything the
// check would otherwise fetch or compute, as files. Each file is validated before use.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChangedFile } from "@groundrule/core";
import { CheckRunPullRequest, RolloutStage } from "@groundrule/spec";
import { z } from "zod";
import type { IO } from "./io.js";
import type { PlatformRulebook } from "./platform.js";

const RelPath = z
  .string()
  .min(1)
  .max(400)
  .refine(
    (p) => !p.startsWith("/") && !p.split("/").includes(".."),
    "must be inside the repository",
  );

const Changes = z
  .array(
    z.strictObject({
      path: RelPath,
      status: z.enum(["added", "modified", "deleted", "renamed"]),
      previousPath: RelPath.optional(),
      changedLines: z
        .array(
          z.strictObject({ start: z.number().int().positive(), end: z.number().int().positive() }),
        )
        .max(100_000),
    }),
  )
  .max(10_000);

const Rulebook = z.object({
  org: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    codingAgents: z.array(z.string()).default([]),
  }),
  target: z.object({
    level: z.enum(["organization", "team", "repository"]),
    team: z.object({ slug: z.string(), name: z.string() }).nullable(),
    repository: z.object({ name: z.string() }).nullable(),
  }),
  repositoryKnown: z.boolean(),
  generatedAt: z.string(),
  standards: z
    .array(z.object({ stage: RolloutStage, origin: z.string(), document: z.unknown() }))
    .max(5_000),
});

export class HostedInputError extends Error {}

async function json(io: IO, file: string, what: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(resolve(io.cwd, file), "utf8"));
  } catch {
    throw new HostedInputError(`Couldn't read ${what} from ${file}: it must be a JSON file.`);
  }
}

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HostedInputError(
      `${what} isn't valid${issue ? ` (${issue.path.join(".") || "top level"}: ${issue.message})` : ""}.`,
    );
  }
  return result.data;
}

export const readChanges = async (io: IO, file: string): Promise<ChangedFile[]> =>
  parsed(Changes, await json(io, file, "the changes"), "The changes file").map(
    ({ previousPath, ...change }) => ({ ...change, ...(previousPath ? { previousPath } : {}) }),
  );

export const readRulebook = async (io: IO, file: string): Promise<PlatformRulebook> =>
  parsed(Rulebook, await json(io, file, "the rulebook"), "The rulebook file") as PlatformRulebook;

export const readPullRequest = async (io: IO, file: string): Promise<CheckRunPullRequest> =>
  parsed(CheckRunPullRequest, await json(io, file, "the pull request"), "The pull request file");
