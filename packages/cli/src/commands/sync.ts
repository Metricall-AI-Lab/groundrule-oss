import { basename } from "node:path";
import { renderTargets, syncOutputs } from "@groundrule/adapters";
import { appliesToRepository, effectiveStandards, inspectRepository } from "@groundrule/core";
import { buildAgentSync } from "../agent-sync.js";
import { pullRequestFromCi } from "../ci.js";
import { EXIT, eprintln, type IO, println, style, VERSION } from "../io.js";
import { call, detectRepository, PlatformError, platformUrl, tokenFor } from "../platform.js";
import { type OpenedWorkspace, openWorkspace } from "../workspace.js";

export interface SyncOptions {
  check?: boolean;
  refresh?: boolean;
  /** Send what this repository delivers to coding agents to Groundrule (RFC 0006). */
  upload?: boolean;
  org?: string;
  url?: string;
  repository?: string;
}

export async function sync(io: IO, options: SyncOptions): Promise<number> {
  const workspace = await openWorkspace(io, {
    ...(options.refresh ? { refresh: true } : {}),
    use: "agents",
  });
  if (!workspace) return EXIT.usage;
  const s = style(io);

  // Fail fast on upload problems before doing the work.
  let upload: { url: string; token: string; org?: string } | undefined;
  if (options.upload) {
    try {
      const url = platformUrl(io, options.url, workspace.config);
      const org = options.org ?? workspace.config.platform?.org;
      const auth = await tokenFor(io, url, org);
      if (!auth) {
        eprintln(
          io,
          `✕ Not signed in${org ? ` to ${org}` : ""} on ${url}. Run \`groundrule login\` (or set GROUNDRULE_TOKEN in CI).`,
        );
        return EXIT.usage;
      }
      upload = { url, token: auth.token, ...(org ? { org } : {}) };
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;
      eprintln(io, `✕ ${error.message}`);
      return EXIT.usage;
    }
  }

  const repo = await inspectRepository(workspace);
  const standards = effectiveStandards(workspace)
    .map((l) => l.standard)
    .filter((standard) => appliesToRepository(standard, repo));
  const outputs = renderTargets({ standards, targets: workspace.config.targets });
  const changes = await syncOutputs(workspace.root, outputs, {
    dryRun: options.check ?? false,
    targets: workspace.config.targets,
  });
  const stale = changes.filter((c) => c.status !== "unchanged");
  const ids = standards.filter((st) => st.spec.agent.instruction).map((st) => st.metadata.id);
  const delivered = ids.length;
  // After writing, every file matches; when only checking, report what was found.
  const report = async () =>
    upload
      ? sendReport(io, upload, workspace, options, {
          changes: options.check
            ? changes
            : changes
                .filter((c) => c.status !== "removed")
                .map((c) => ({ ...c, status: "unchanged" as const })),
          ids,
        })
      : undefined;

  if (options.check) {
    if (stale.length === 0) {
      println(io, `${s.green("✓")} Agent instructions are up to date (${delivered} standards).`);
      await report();
      return EXIT.ok;
    }
    println(io, `${s.red("✕")} Agent instructions are out of date:`);
    for (const c of stale) println(io, `   ${c.path} ${s.dim(`would be ${c.status}`)}`);
    println(io, `   Run ${s.bold("groundrule sync")} and commit the result.`);
    await report();
    return EXIT.failed;
  }

  println(io);
  println(
    io,
    ` ${s.bold("groundrule sync")} ${s.dim(`· ${delivered} standards → ${workspace.config.targets.join(", ")}`)}`,
  );
  if (workspace.platform) {
    const { org, target } = workspace.platform.rulebook;
    const where = target.repository
      ? `${target.repository.name}${target.team ? `, team ${target.team.name}` : ""}`
      : "organization rules";
    println(
      io,
      `   ${s.dim(`From ${org.name} on Groundrule (${where}): rules at Teach, Advise, and Enforce`)}`,
    );
  }
  println(io);
  const icon = {
    created: s.green("+"),
    updated: s.yellow("~"),
    removed: s.red("−"),
    unchanged: s.dim("="),
  };
  for (const c of changes) println(io, `   ${icon[c.status]} ${c.path} ${s.dim(c.status)}`);
  println(io);
  println(
    io,
    stale.length
      ? ` ${s.green("✓")} Done. Commit these files so every agent gets the same rules.`
      : ` ${s.green("✓")} Already up to date.`,
  );
  await report();
  println(io);
  return EXIT.ok;
}

/** Upload the report. Never changes the exit code: a platform outage must not fail CI. */
async function sendReport(
  io: IO,
  upload: { url: string; token: string; org?: string },
  workspace: OpenedWorkspace,
  options: SyncOptions,
  data: {
    changes: readonly { path: string; status: "created" | "updated" | "unchanged" | "removed" }[];
    ids: string[];
  },
) {
  try {
    const body = await buildAgentSync({
      root: workspace.root,
      cliVersion: VERSION,
      repositoryName:
        options.repository ??
        workspace.config.platform?.repository ??
        (await detectRepository(workspace.root)) ??
        basename(workspace.root),
      rulebook: workspace.platform ? "platform" : "local",
      targets: workspace.config.targets,
      changes: data.changes,
      standardIds: data.ids,
      pullRequest: await pullRequestFromCi(io),
    });
    const query = upload.org ? `?org=${encodeURIComponent(upload.org)}` : "";
    const res = await call<{ url: string; org: { slug: string; name: string } }>(
      io,
      upload.url,
      `/v1/cli/agent-syncs${query}`,
      { method: "POST", token: upload.token, body },
    );
    println(io, `   ${style(io).green("✓")} Reported to ${res.org.name}: ${res.url}`);
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    const reason =
      error.status === 403 && error.message.includes("scans:write")
        ? "this token can't upload. Run `groundrule login` again, or create a token with “Upload scans and check results” in Settings → API tokens."
        : error.message;
    eprintln(io, `! Upload failed: ${reason} The result above still stands.`);
  }
}
