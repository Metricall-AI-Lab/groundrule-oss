import { appendFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildCheckRun, GitError, runChecks } from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import {
  colorEnabled,
  type Format,
  renderJson,
  renderMarkdown,
  renderSarif,
  renderTerminal,
} from "@groundrule/reporters";
import { pullRequestFromCi } from "../ci.js";
import { HostedInputError, readChanges, readPullRequest, readRulebook } from "../hosted.js";
import { EXIT, eprintln, type IO, println, style, VERSION } from "../io.js";
import { call, detectRepository, PlatformError, platformUrl, tokenFor } from "../platform.js";
import { openWorkspace, printDiagnostics } from "../workspace.js";

export interface CheckOptions {
  base?: string;
  all?: boolean;
  format: Format;
  output?: string;
  /** Also append a Markdown summary to this file (e.g. $GITHUB_STEP_SUMMARY). */
  summary?: string;
  failOn?: "blocker" | "warning" | "none";
  verbose?: boolean;
  only?: string[];
  /** Send the result to the organization on Groundrule (RFC 0005). */
  upload?: boolean;
  /** Include the offending line of each finding in the upload (default true). */
  snippets?: boolean;
  org?: string;
  url?: string;
  repository?: string;
  /** Hosted checks: no network at all (no platform, no remote packs). */
  offline?: boolean;
  /** Hosted checks: the organization's rulebook, as a file, instead of fetching it. */
  rulebook?: string;
  /** Hosted checks: the changed files and lines, as a file, instead of asking git. */
  changes?: string;
  /** Hosted checks: the pull request (CheckRunPullRequest), as a file. */
  pullRequest?: string;
  /** Hosted checks: the commit under check. */
  commit?: string;
  /** Also write the result as a CheckRun (RFC 0005) to this file. */
  writeCheckRun?: string;
}

export async function check(io: IO, options: CheckOptions): Promise<number> {
  if (options.offline && options.upload) {
    eprintln(io, "✕ --offline and --upload can't be used together.");
    return EXIT.usage;
  }
  if (options.commit && !/^[0-9a-f]{40}$/.test(options.commit)) {
    eprintln(io, "✕ --commit must be a full 40-character commit SHA.");
    return EXIT.usage;
  }
  let hosted: {
    rulebook?: Awaited<ReturnType<typeof readRulebook>>;
    changes?: Awaited<ReturnType<typeof readChanges>>;
    pullRequest?: Awaited<ReturnType<typeof readPullRequest>>;
  } = {};
  try {
    hosted = {
      ...(options.rulebook ? { rulebook: await readRulebook(io, options.rulebook) } : {}),
      ...(options.changes ? { changes: await readChanges(io, options.changes) } : {}),
      ...(options.pullRequest
        ? { pullRequest: await readPullRequest(io, options.pullRequest) }
        : {}),
    };
  } catch (error) {
    if (!(error instanceof HostedInputError)) throw error;
    eprintln(io, `✕ ${error.message}`);
    return EXIT.usage;
  }
  // From the platform: Enforce rules as set, Advise rules as warnings, Teach rules not checked.
  const workspace = await openWorkspace(io, {
    use: "checks",
    ...(options.offline ? { offline: true } : {}),
    ...(hosted.rulebook ? { rulebook: hosted.rulebook } : {}),
  });
  if (!workspace) return EXIT.usage;
  if (options.failOn) workspace.config.enforcement.failOn = options.failOn;

  // Fail fast on upload problems before spending time on the checks.
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

  let result: Awaited<ReturnType<typeof runChecks>>;
  try {
    result = await runChecks({
      workspace,
      evaluators: builtinEvaluators,
      ...(options.all
        ? { mode: "all" as const }
        : options.base || hosted.changes
          ? { mode: "changes" as const }
          : {}),
      ...(options.base ? { base: options.base } : {}),
      ...(hosted.changes && !options.all ? { changes: hosted.changes } : {}),
      ...(options.only?.length ? { only: options.only } : {}),
    });
  } catch (error) {
    if (error instanceof GitError) {
      eprintln(io, `✕ ${error.message}`);
      return EXIT.usage;
    }
    throw error;
  }

  const input = { result, standards: workspace.standards, version: VERSION };
  if (options.format === "terminal") {
    // Diagnostics from the run are part of the terminal report.
    io.stdout.write(
      renderTerminal(input, {
        color: colorEnabled(io.stdout, io.env),
        verbose: options.verbose ?? false,
      }),
    );
  } else {
    printDiagnostics(io, result.diagnostics, workspace.root);
    const render = { json: renderJson, sarif: renderSarif, markdown: renderMarkdown }[
      options.format
    ];
    const text = render(input);
    if (options.output) {
      await writeFile(resolve(io.cwd, options.output), text);
      println(
        io,
        `Wrote ${options.format} report to ${options.output} (${result.failed ? "failed" : "passed"}).`,
      );
    } else io.stdout.write(text);
  }

  if (options.summary) await appendFile(resolve(io.cwd, options.summary), renderMarkdown(input));

  const code = result.diagnostics.some((d) => d.severity === "error")
    ? EXIT.usage
    : result.failed
      ? EXIT.failed
      : EXIT.ok;

  if (options.writeCheckRun) {
    const run = await buildCheckRun({
      result,
      standards: workspace.standards,
      cliVersion: VERSION,
      snippets: options.snippets !== false,
      failOn: workspace.config.enforcement.failOn,
      repositoryName:
        options.repository ??
        workspace.config.platform?.repository ??
        (options.offline ? undefined : await detectRepository(workspace.root)) ??
        basename(workspace.root),
      pullRequest:
        hosted.pullRequest ?? (options.offline ? undefined : await pullRequestFromCi(io)),
      ...(options.commit ? { commit: options.commit } : {}),
    });
    await writeFile(resolve(io.cwd, options.writeCheckRun), `${JSON.stringify(run)}\n`);
  }
  if (!upload) return code;

  // The check's own result stands whatever happens to the upload: a platform outage must
  // never block a merge.
  const out = options.format === "terminal" || options.output ? println : eprintln;
  try {
    const run = await buildCheckRun({
      result,
      standards: workspace.standards,
      cliVersion: VERSION,
      snippets: options.snippets !== false,
      failOn: workspace.config.enforcement.failOn,
      repositoryName:
        options.repository ??
        workspace.config.platform?.repository ??
        (await detectRepository(workspace.root)) ??
        basename(workspace.root),
      pullRequest: await pullRequestFromCi(io),
    });
    const query = upload.org ? `?org=${encodeURIComponent(upload.org)}` : "";
    const res = await call<{ id: string; url: string; org: { slug: string; name: string } }>(
      io,
      upload.url,
      `/v1/cli/checks${query}`,
      { method: "POST", token: upload.token, body: run },
    );
    out(io, ` ${style(io, "stdout").green("✓")} Uploaded to ${res.org.name}: ${res.url}`);
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    const reason =
      error.status === 403 && error.message.includes("scans:write")
        ? "this token can't upload results. Run `groundrule login` again, or create a token with “Upload scans and check results” in Settings → API tokens."
        : error.message;
    eprintln(io, `! Upload failed: ${reason} The check result above still stands.`);
  }
  return code;
}
