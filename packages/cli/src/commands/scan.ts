import { readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  findConfig,
  gitRoot,
  type LoadedStandard,
  loadFile,
  scanRepository,
} from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import { CATALOG_DIR, listPacks } from "@groundrule/packs";
import type { Config, ScanReport, ScanRule } from "@groundrule/spec";
import { EXIT, eprintln, type IO, println, style, VERSION } from "../io.js";
import { call, detectRepository, PlatformError, platformUrl, tokenFor } from "../platform.js";

export interface ScanOptions {
  json?: boolean;
  output?: string;
  upload?: boolean;
  snippets?: boolean;
  repository?: string;
  org?: string;
  url?: string;
}

/** Every rule in the bundled catalog, with the pack it comes from. */
async function catalogStandards(): Promise<LoadedStandard[]> {
  const out: LoadedStandard[] = [];
  for (const pack of await listPacks()) {
    const dir = join(CATALOG_DIR, pack.id, "standards");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort()) {
      const result = await loadFile(join(dir, file), "Standard");
      if (result.ok)
        out.push({
          standard: result.document,
          file: join(dir, file),
          origin: pack.ref,
          disabled: false,
        });
    }
  }
  return out;
}

async function repoConfig(cwd: string): Promise<Config | undefined> {
  const file = await findConfig(cwd);
  if (!file) return undefined;
  const result = await loadFile(file, "Config");
  return result.ok ? result.document : undefined;
}

/**
 * `groundrule scan`: observe this repository against the whole catalog, without changing
 * or enforcing anything. Prints a summary; --json/--output write the report; --upload
 * shares it with your organization on the platform.
 */
export async function scan(io: IO, options: ScanOptions): Promise<number> {
  const s = style(io);
  const root = (await gitRoot(io.cwd)) ?? io.cwd;
  const config = await repoConfig(io.cwd);
  const repositoryName =
    options.repository ??
    config?.platform?.repository ??
    (await detectRepository(root)) ??
    basename(root);

  // Fail fast on upload problems before spending time on the scan.
  let upload: { url: string; token: string; org?: string } | undefined;
  if (options.upload) {
    try {
      const url = platformUrl(io, options.url, config);
      const org = options.org ?? config?.platform?.org;
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

  const report = await scanRepository({
    root,
    standards: await catalogStandards(),
    evaluators: builtinEvaluators,
    cliVersion: VERSION,
    snippets: options.snippets !== false,
    repositoryName,
    tags: config?.tags ?? [],
  });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) await writeFile(resolve(io.cwd, options.output), json);
  if (options.json) io.stdout.write(json);
  else printSummary(io, report, options);

  if (!upload) return EXIT.ok;
  try {
    const query = upload.org ? `?org=${encodeURIComponent(upload.org)}` : "";
    const res = await call<{ id: string; url: string; org: { slug: string; name: string } }>(
      io,
      upload.url,
      `/v1/cli/scans${query}`,
      { method: "POST", token: upload.token, body: report },
    );
    const out = options.json ? (t: string) => eprintln(io, t) : (t: string) => println(io, t);
    out(` ${s.green("✓")} Uploaded to ${res.org.name}: ${res.url}`);
    if (!options.json) println(io);
    return EXIT.ok;
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    eprintln(
      io,
      `✕ Upload failed: ${error.status === 403 && error.message.includes("scans:write") ? "this token can't upload scans. Run `groundrule login` again, or create a token with “Upload scans” in Settings → API tokens." : error.message}`,
    );
    return EXIT.usage;
  }
}

const LANGUAGE: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  java: "Java",
  kotlin: "Kotlin",
  go: "Go",
  ruby: "Ruby",
  php: "PHP",
  rust: "Rust",
  csharp: "C#",
};

function printSummary(io: IO, report: ScanReport, options: ScanOptions) {
  const s = style(io);
  const { summary, stack } = report;
  const applies = summary.rules - summary.notApplicable;
  const label = (k: string) => s.dim(k.padEnd(12));
  const list = (items: string[], empty: string) => (items.length ? items.join(", ") : s.dim(empty));

  println(io);
  println(
    io,
    ` ${s.bold("groundrule scan")} ${s.dim(`· ${report.repository.name} · ${report.repository.files.toLocaleString("en-US")} files · ${(report.metadata.durationMs / 1000).toFixed(1)}s`)}`,
  );
  println(io);
  println(
    io,
    ` ${label("Stack")}${list(
      [...stack.languages.map((l) => LANGUAGE[l] ?? l), ...stack.frameworks],
      "nothing recognized",
    )}`,
  );
  println(
    io,
    ` ${label("Agent files")}${list(
      report.agentFiles.map(
        (f) => `${f.path} ${s.dim(`(${f.lines} lines${f.managed ? ", from sync" : ""})`)}`,
      ),
      "none yet",
    )}`,
  );
  println(
    io,
    ` ${label("Tools")}${list(
      report.tools.map((t) => {
        const extra = [
          t.facts.strict === true ? "strict" : t.facts.strict === false ? "not strict" : "",
          typeof t.facts.files === "number" ? `${t.facts.files} files` : "",
          typeof t.facts.rules === "number" ? `${t.facts.rules} rules` : "",
        ].filter(Boolean);
        return extra.length ? `${t.id} ${s.dim(`(${extra.join(", ")})`)}` : t.id;
      }),
      "none found",
    )}`,
  );
  println(io);
  println(
    io,
    ` ${label("Rules")}${summary.rules} in the catalog · ${s.bold(String(applies))} apply here`,
  );
  println(
    io,
    ` ${" ".repeat(12)}${s.green(`✓ ${summary.clean} already pass`)}   ${s.yellow(`! ${summary.violations} with findings (${summary.findings})`)}   ${s.dim(`◇ ${summary.guidance} guidance only`)}`,
  );

  const clean = report.rules.filter((r) => r.outcome === "clean" && r.filesInScope > 0);
  if (clean.length) {
    println(io);
    println(io, ` ${s.bold("Already passing")} ${s.dim("· safe to adopt at Enforce today")}`);
    for (const r of clean.slice(0, 8))
      println(
        io,
        `   ${s.green("✓")} ${r.id.padEnd(10)} ${s.dim(r.pack.replace("groundrule:packs/", ""))}`,
      );
    if (clean.length > 8) println(io, `   ${s.dim(`… and ${clean.length - 8} more`)}`);
  }

  const noisy = report.rules
    .filter((r) => r.outcome === "violations")
    .sort((a, b) => b.findings - a.findings);
  if (noisy.length) {
    println(io);
    println(
      io,
      ` ${s.bold("Most findings")} ${s.dim("· start these at Observe or Teach, or clean up first")}`,
    );
    for (const r of noisy.slice(0, 8)) println(io, `   ${s.yellow("!")} ${describe(r)}`);
    if (noisy.length > 8) println(io, `   ${s.dim(`… and ${noisy.length - 8} more`)}`);
  }

  const packs = [
    ...new Set(
      report.rules
        // A pack fits when its checks found files to look at here.
        .filter((r) => r.filesInScope > 0 && r.pack.startsWith("groundrule:packs/"))
        .map((r) => r.pack.replace("groundrule:packs/", "")),
    ),
  ].sort();
  println(io);
  println(io, ` ${label("Packs")}${list(packs, "none")} ${s.dim("apply to this repository")}`);
  println(io);
  if (!options.upload) {
    println(
      io,
      ` ${s.dim("Nothing left this computer.")} Run ${s.bold("groundrule scan --upload")} to share it with your organization, or ${s.bold("--json")} to see exactly what would be sent.`,
    );
    println(io);
  }
}

const describe = (r: ScanRule) =>
  `${r.id.padEnd(10)} ${r.findings} finding${r.findings === 1 ? "" : "s"}${r.filesAffected ? ` in ${r.filesAffected} file${r.filesAffected === 1 ? "" : "s"}` : ""}${r.examples[0]?.file ? `, e.g. ${r.examples[0].file}${r.examples[0].line ? `:${r.examples[0].line}` : ""}` : ""}`;
