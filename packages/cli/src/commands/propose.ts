import { findConfig, gitRoot, loadFile } from "@groundrule/core";
import type { Config } from "@groundrule/spec";
import { z } from "zod";
import { EXIT, eprintln, type IO, println, style } from "../io.js";
import { call, detectRepository, PlatformError, platformUrl, tokenFor } from "../platform.js";

/** What a developer (or their coding agent) proposes. Checked here and again by the platform. */
export const Proposal = z.strictObject({
  rule: z.string().trim().min(10, "Say the rule in a sentence.").max(1000),
  why: z.string().trim().max(1000).optional(),
  example: z.string().max(2000).optional(),
  file: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .refine(
      (p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."),
      "Use a path relative to the repository.",
    )
    .optional(),
  line: z.number().int().positive().optional(),
});
export type Proposal = z.infer<typeof Proposal>;

export interface Proposed {
  id: string;
  status: "open" | "accepted" | "rejected";
  duplicate: boolean;
  similar: { id: string; score: number }[];
  url: string;
  org: { slug: string; name: string };
}

async function repoConfig(cwd: string): Promise<Config | undefined> {
  const file = await findConfig(cwd);
  if (!file) return undefined;
  const result = await loadFile(file, "Config");
  return result.ok ? result.document : undefined;
}

/**
 * Send a proposal to the organization this repository is connected to. Throws
 * PlatformError with a message for people when it can't.
 */
export async function sendProposal(
  io: IO,
  proposal: Proposal,
  via: "cli" | "mcp",
  options: { org?: string; url?: string; agent?: string } = {},
): Promise<Proposed> {
  const config = await repoConfig(io.cwd);
  const org = options.org ?? config?.platform?.org;
  if (!org && !io.env.GROUNDRULE_TOKEN)
    throw new PlatformError(
      "This repository isn't connected to Groundrule. Run `groundrule init --org <your-org>`, or pass --org.",
    );
  const url = platformUrl(io, options.url, config);
  const auth = await tokenFor(io, url, org);
  if (!auth)
    throw new PlatformError(
      `Not signed in${org ? ` to ${org}` : ""} on ${url}. Run \`groundrule login\` first.`,
    );
  const root = (await gitRoot(io.cwd)) ?? io.cwd;
  const repository = config?.platform?.repository ?? (await detectRepository(root));
  try {
    return await call<Proposed>(io, url, "/v1/cli/proposals", {
      method: "POST",
      token: auth.token,
      body: {
        ...proposal,
        via,
        ...(repository ? { repository } : {}),
        ...(options.agent ? { agent: options.agent } : {}),
      },
    });
  } catch (error) {
    if (error instanceof PlatformError && error.status === 403)
      throw new PlatformError(
        "This sign-in can't propose rules yet. Run `groundrule login` again to refresh it.",
        error.code,
        403,
      );
    throw error;
  }
}

/** `groundrule propose "<rule>"`: suggest a rule for your team to review. */
export async function propose(
  io: IO,
  rule: string,
  options: {
    why?: string;
    example?: string;
    file?: string;
    org?: string;
    url?: string;
    json?: boolean;
  },
): Promise<number> {
  const s = style(io);
  const [file, line] = (() => {
    const m = options.file?.match(/^(.*?):(\d+)$/);
    return m?.[1] ? [m[1], Number(m[2])] : [options.file, undefined];
  })();
  const parsed = Proposal.safeParse({
    rule,
    ...(options.why ? { why: options.why } : {}),
    ...(options.example ? { example: options.example } : {}),
    ...(file ? { file } : {}),
    ...(line ? { line } : {}),
  });
  if (!parsed.success) {
    eprintln(io, `✕ ${parsed.error.issues[0]?.message ?? "Check the proposal."}`);
    return EXIT.usage;
  }
  let res: Proposed;
  try {
    res = await sendProposal(io, parsed.data, "cli", {
      ...(options.org ? { org: options.org } : {}),
      ...(options.url ? { url: options.url } : {}),
    });
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    eprintln(io, `✕ ${error.message}`);
    return EXIT.usage;
  }
  if (options.json) {
    io.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return EXIT.ok;
  }
  println(io);
  if (res.status === "rejected")
    println(
      io,
      ` ${s.yellow("!")} A reviewer already rejected this rule in ${res.org.name}. Ask them to reopen it if things have changed.`,
    );
  else if (res.duplicate)
    println(
      io,
      ` ${s.green("✓")} Already proposed in ${res.org.name}; your vote is added. ${s.dim(res.url)}`,
    );
  else
    println(
      io,
      ` ${s.green("✓")} Proposed to ${res.org.name}. Reviewers will see it in the inbox: ${res.url}`,
    );
  if (res.similar.length)
    println(
      io,
      `   ${s.dim(`Similar rules: ${res.similar.map((m) => m.id).join(", ")} (run groundrule explain <ID>)`)}`,
    );
  println(io);
  return EXIT.ok;
}
