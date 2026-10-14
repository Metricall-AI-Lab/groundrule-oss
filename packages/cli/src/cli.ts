import { FORMATS, type Format } from "@groundrule/reporters";
import { AGENT_TARGETS, type AgentTarget } from "@groundrule/spec";
import { Argument, Command, CommanderError, Option } from "commander";
import { check } from "./commands/check.js";
import { doctor } from "./commands/doctor.js";
import { explain } from "./commands/explain.js";
import { HOOK_AGENTS, type HookAgent, hook, hooks } from "./commands/hooks.js";
import { init } from "./commands/init.js";
import { keysGenerate, keysId } from "./commands/keys.js";
import { login, logout, whoami } from "./commands/login.js";
import { mcp } from "./commands/mcp.js";
import { packs } from "./commands/packs.js";
import { propose } from "./commands/propose.js";
import { scan } from "./commands/scan.js";
import { standards } from "./commands/standards.js";
import { sync } from "./commands/sync.js";
import { verify } from "./commands/verify.js";
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
    .command("scan")
    .description("observe this repository against the whole catalog (changes nothing)")
    .option("--json", "print the report as JSON instead of a summary")
    .option("-o, --output <file>", "also write the report to a file")
    .option("--upload", "share the report with your organization on Groundrule")
    .option("--no-snippets", "leave code snippets out of the report")
    .option(
      "--no-import",
      "leave out instructions, tool settings, and owners found in the repository",
    )
    .option("--repository <name>", "repository name, e.g. acme/api (default: from the git remote)")
    .option("--org <slug>", "organization to upload to")
    .option("--url <url>", "Groundrule platform address")
    .action(
      async (o: {
        json?: boolean;
        output?: string;
        upload?: boolean;
        snippets?: boolean;
        import?: boolean;
        repository?: string;
        org?: string;
        url?: string;
      }) => {
        code = await scan(ctx(), o);
      },
    );

  program
    .command("propose")
    .description("propose a rule for your team to review on Groundrule")
    .argument("<rule...>", 'the rule, e.g. "Never call Stripe directly; use PaymentsGateway"')
    .option("--why <reason>", "why the team should follow it")
    .option("--example <code>", "a short example of the right or wrong way")
    .option("--file <path[:line]>", "where it came up, e.g. src/pay.ts:42")
    .option("--org <slug>", "organization (default: from .groundrule/config.yaml)")
    .option("--url <url>", "Groundrule platform address")
    .option("--json", "machine-readable output")
    .action(
      async (
        rule: string[],
        o: {
          why?: string;
          example?: string;
          file?: string;
          org?: string;
          url?: string;
          json?: boolean;
        },
      ) => {
        code = await propose(ctx(), rule.join(" "), o);
      },
    );

  program
    .command("mcp")
    .description(
      "serve your standards to coding agents over MCP (stdio), and let them propose rules",
    )
    .action(async () => {
      code = await mcp(ctx());
    });

  program
    .command("hooks")
    .description(
      "have coding agents run the check when they finish a task (Claude Code, Codex, Cursor, Copilot)",
    )
    .addOption(
      new Option(
        "--agents <list>",
        `agents (${HOOK_AGENTS.join(", ")}; default: Claude Code and the ones this repository uses)`,
      ).argParser(list),
    )
    .option("--remove", "remove the Groundrule hooks")
    .action(async (o: { agents?: string[]; remove?: boolean }) => {
      const unknown = o.agents?.filter((a) => !(HOOK_AGENTS as readonly string[]).includes(a));
      if (unknown?.length) {
        eprintln(io, `✕ Unknown agent: ${unknown.join(", ")}. Use ${HOOK_AGENTS.join(", ")}.`);
        code = EXIT.usage;
        return;
      }
      code = await hooks(ctx(), {
        ...(o.agents ? { agents: o.agents as HookAgent[] } : {}),
        ...(o.remove ? { remove: true } : {}),
      });
    });

  program
    .command("hook", { hidden: true })
    .description("run by a coding agent's hook when it finishes; tells it what to fix")
    .addArgument(new Argument("<agent>").choices(HOOK_AGENTS))
    .action(async (agent: HookAgent) => {
      code = await hook(ctx(), agent);
    });

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
    .option("--upload", "report what this repository delivers to coding agents to Groundrule")
    .option("--org <slug>", "organization (default: from .groundrule/config.yaml)")
    .option("--url <url>", "Groundrule platform address")
    .option("--repository <name>", "repository name, e.g. acme/api (default: from the git remote)")
    .action(
      async (o: {
        check?: boolean;
        refresh?: boolean;
        upload?: boolean;
        org?: string;
        url?: string;
        repository?: string;
      }) => {
        code = await sync(ctx(), o);
      },
    );

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
    .option("--upload", "send the result to your organization on Groundrule")
    .option("--no-snippets", "with --upload: leave code snippets out")
    .option(
      "--no-authorship",
      "with --upload: don't record which coding agents the commits declare",
    )
    .option("--sign", "sign the result with GROUNDRULE_SIGNING_KEY (the default when it is set)")
    .option("--no-sign", "don't sign the result")
    .option("--repository <name>", "repository name, e.g. acme/api (default: from the git remote)")
    .option("--org <slug>", "organization to upload to")
    .option("--url <url>", "Groundrule platform address")
    // Hosted checks (Groundrule's sandbox): every input as a file, no network, no git.
    .addOption(new Option("--offline", "never reach the network").hideHelp())
    .addOption(new Option("--rulebook <file>", "the organization's rulebook, as JSON").hideHelp())
    .addOption(new Option("--changes <file>", "changed files and lines, as JSON").hideHelp())
    .addOption(new Option("--pull-request <file>", "the pull request, as JSON").hideHelp())
    .addOption(new Option("--commit <sha>", "the commit under check").hideHelp())
    .addOption(
      new Option("--write-check-run <file>", "also write the result as a CheckRun").hideHelp(),
    )
    .action(
      async (o: {
        offline?: boolean;
        rulebook?: string;
        changes?: string;
        pullRequest?: string;
        commit?: string;
        writeCheckRun?: string;
        base?: string;
        all?: boolean;
        format: Format;
        output?: string;
        summary?: string;
        failOn?: "blocker" | "warning" | "none";
        only?: string[];
        verbose?: boolean;
        upload?: boolean;
        snippets?: boolean;
        authorship?: boolean;
        sign?: boolean;
        repository?: string;
        org?: string;
        url?: string;
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
          ...(o.upload ? { upload: true } : {}),
          ...(o.snippets === false ? { snippets: false } : {}),
          ...(o.authorship === false ? { authorship: false } : {}),
          ...(o.sign !== undefined ? { sign: o.sign } : {}),
          ...(o.repository ? { repository: o.repository } : {}),
          ...(o.org ? { org: o.org } : {}),
          ...(o.url ? { url: o.url } : {}),
          ...(o.offline ? { offline: true } : {}),
          ...(o.rulebook ? { rulebook: o.rulebook } : {}),
          ...(o.changes ? { changes: o.changes } : {}),
          ...(o.pullRequest ? { pullRequest: o.pullRequest } : {}),
          ...(o.commit ? { commit: o.commit } : {}),
          ...(o.writeCheckRun ? { writeCheckRun: o.writeCheckRun } : {}),
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

  const keys = program.command("keys").description("signing keys for check results (RFC 0008)");
  keys
    .command("generate")
    .description("create a key pair: the private key for CI, the public key for Groundrule")
    .option("--out <dir>", "where to write the two files (default: here)")
    .action(async (o: { out?: string }) => {
      code = await keysGenerate(ctx(), o);
    });
  keys
    .command("id")
    .description("print a public key's ID, as runs and Groundrule name it")
    .argument("<file>", "the public key, PEM")
    .action(async (file: string) => {
      code = await keysId(ctx(), file);
    });

  program
    .command("verify")
    .description("check a run's signature with a public key, offline")
    .argument("<file>", "a CheckRun, JSON")
    .requiredOption("--key <file>", "the signer's public key, PEM")
    .action(async (file: string, o: { key: string }) => {
      code = await verify(ctx(), file, o);
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
