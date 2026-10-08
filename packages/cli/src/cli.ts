import { FORMATS, type Format } from "@groundrule/reporters";
import { AGENT_TARGETS, type AgentTarget } from "@groundrule/spec";
import { Command, CommanderError, Option } from "commander";
import { check } from "./commands/check.js";
import { doctor } from "./commands/doctor.js";
import { explain } from "./commands/explain.js";
import { init } from "./commands/init.js";
import { login, logout, whoami } from "./commands/login.js";
import { packs } from "./commands/packs.js";
import { standards } from "./commands/standards.js";
import { sync } from "./commands/sync.js";
import { EXIT, eprintln, type IO, VERSION } from "./io.js";

const list = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

/** Run the CLI and return the exit code. Never calls process.exit. */
export async function run(argv: readonly string[], io: IO): Promise<number> {
  let code: number = EXIT.ok;
  const program = new Command()
    .name("groundrule")
    .description("Define engineering standards once. Enforce them everywhere.")
    .version(VERSION, "-v, --version")
    .option("-C, --cwd <dir>", "run as if started in <dir>")
    .configureOutput({ writeOut: (t) => io.stdout.write(t), writeErr: (t) => io.stderr.write(t) })
    .exitOverride()
    .showHelpAfterError("(run groundrule --help for usage)");

  const ctx = (): IO => {
    const cwd = program.opts<{ cwd?: string }>().cwd;
    return cwd ? { ...io, cwd: new URL(cwd, `file://${io.cwd}/`).pathname } : io;
  };

  program
    .command("init")
    .description("create .groundrule/config.yaml for this repository")
    .addOption(
      new Option("--targets <list>", `agent formats (${AGENT_TARGETS.join(", ")})`).argParser(list),
    )
    .option(
      "--packs <list>",
      "bundled packs to extend, e.g. security-baseline,typescript-node",
      list,
    )
    .option("--force", "overwrite an existing config")
    .option("--org <slug>", "take standards from your organization on Groundrule")
    .option("--url <url>", "Groundrule platform address (default https://app.groundrule.dev)")
    .action(
      async (o: {
        targets?: string[];
        packs?: string[];
        force?: boolean;
        org?: string;
        url?: string;
      }) => {
        const bad = o.targets?.filter((t) => !(AGENT_TARGETS as readonly string[]).includes(t));
        if (bad?.length) {
          eprintln(io, `✕ Unknown target ${bad.join(", ")}. Use ${AGENT_TARGETS.join(", ")}.`);
          code = EXIT.usage;
          return;
        }
        if (o.org && o.packs) {
          eprintln(
            io,
            "✕ Use --org or --packs, not both: with --org, your organization decides the packs.",
          );
          code = EXIT.usage;
          return;
        }
        code = await init(ctx(), {
          ...(o.targets ? { targets: o.targets as AgentTarget[] } : {}),
          ...(o.packs ? { packs: o.packs } : {}),
          ...(o.force ? { force: true } : {}),
          ...(o.org ? { org: o.org } : {}),
          ...(o.url ? { url: o.url } : {}),
        });
      },
    );

  program
    .command("login")
    .description("sign in to your organization on Groundrule (opens your browser)")
    .option("--url <url>", "Groundrule platform address (default https://app.groundrule.dev)")
    .option("--no-browser", "print the link instead of opening a browser")
    .action(async (o: { url?: string; browser?: boolean }) => {
      code = await login(ctx(), o);
    });

  program
    .command("logout")
    .description("sign out and revoke the saved token")
    .option("--org <slug>", "only this organization")
    .option("--url <url>", "Groundrule platform address")
    .action(async (o: { org?: string; url?: string }) => {
      code = await logout(ctx(), o);
    });

  program
    .command("whoami")
    .description("show which organization and account you're signed in as")
    .option("--url <url>", "Groundrule platform address")
    .option("--json", "machine-readable output")
    .action(async (o: { url?: string; json?: boolean }) => {
      code = await whoami(ctx(), o);
    });

  program
    .command("sync")
    .description("write coding-agent instructions (AGENTS.md, CLAUDE.md, Cursor, Copilot)")
    .option("--check", "exit 1 if the files are out of date instead of writing them")
    .option("--refresh", "re-fetch remote packs")
    .action(async (o: { check?: boolean; refresh?: boolean }) => {
      code = await sync(ctx(), o);
    });

  program
    .command("check")
    .description("check your changes (or everything with --all) against the standards")
    .option("--base <ref>", "compare against a branch or commit, e.g. origin/main")
    .option("--all", "audit every file, not just changes")
    .addOption(
      new Option("-f, --format <format>", "output format").choices(FORMATS).default("terminal"),
    )
    .option("-o, --output <file>", "write the report to a file")
    .option(
      "--summary <file>",
      "also append a Markdown summary to a file, e.g. $GITHUB_STEP_SUMMARY",
    )
    .addOption(
      new Option("--fail-on <severity>", "lowest severity that fails").choices([
        "blocker",
        "warning",
        "none",
      ]),
    )
    .option("--only <ids>", "only these standard IDs, comma-separated", list)
    .option("--verbose", "also show legacy and excepted findings")
    .action(
      async (o: {
        base?: string;
        all?: boolean;
        format: Format;
        output?: string;
        summary?: string;
        failOn?: "blocker" | "warning" | "none";
        only?: string[];
        verbose?: boolean;
      }) => {
        code = await check(ctx(), {
          format: o.format,
          ...(o.base ? { base: o.base } : {}),
          ...(o.all ? { all: true } : {}),
          ...(o.output ? { output: o.output } : {}),
          ...(o.summary ? { summary: o.summary } : {}),
          ...(o.failOn ? { failOn: o.failOn } : {}),
          ...(o.only ? { only: o.only.map((id) => id.toUpperCase()) } : {}),
          ...(o.verbose ? { verbose: true } : {}),
        });
      },
    );

  program
    .command("standards")
    .description("list the standards in effect for this repository")
    .option("--json", "machine-readable output")
    .action(async (o: { json?: boolean }) => {
      code = await standards(ctx(), o);
    });

  program
    .command("explain")
    .description("explain a standard: why it exists, examples, how to comply")
    .argument("<id>", "standard ID, e.g. AUTH-017")
    .action(async (id: string) => {
      code = await explain(ctx(), id);
    });

  program
    .command("doctor")
    .description("check configuration, tools, and agent files")
    .action(async () => {
      code = await doctor(ctx());
    });

  program
    .command("packs")
    .description("list bundled standard packs")
    .action(async () => {
      code = await packs(ctx());
    });

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.code === "commander.helpDisplayed" ||
        error.code === "commander.version" ||
        error.code === "commander.help"
        ? EXIT.ok
        : EXIT.usage;
    }
    eprintln(io, `✕ ${error instanceof Error ? error.message : String(error)}`);
    if (io.env.GROUNDRULE_DEBUG && error instanceof Error && error.stack) eprintln(io, error.stack);
    return EXIT.usage;
  }
  return code;
}
