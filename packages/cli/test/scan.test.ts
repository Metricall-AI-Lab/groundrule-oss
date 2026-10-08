// `groundrule scan`: observes the repository against the whole catalog, prints a summary or
// the report, and uploads only when asked. The platform is a fake; nothing leaves the test.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ScanReport } from "@groundrule/spec";
import { afterEach, describe, expect, it } from "vitest";
import { type IO, run } from "../src/index.js";

const URL_ = "https://app.groundrule.test";
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function repo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-scan-"));
  dirs.push(root);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/web.git"], { cwd: root });
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  return root;
}

const APP = {
  "package.json": '{ "name": "web", "dependencies": { "react": "^19.0.0" } }\n',
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
  "AGENTS.md": "# How we work\n\n- Small changes\n- Never log tokens or personal data.\n",
  "CLAUDE.md": "@AGENTS.md\n",
  "eslint.config.mjs": 'export default [{ rules: { "no-console": "error" } }];\n',
  ".github/CODEOWNERS": "* @acme/web\n/.github/workflows/ @acme/devex\n",
  "src/app.ts": 'export const run = () => console.log("started");\n',
};

interface Call {
  path: string;
  auth?: string | undefined;
  body?: unknown;
}

function fakePlatform(status = 201) {
  const calls: Call[] = [];
  const respond = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({
      path: `${url.pathname.replace(/^\/api/, "")}${url.search}`,
      auth: (init?.headers as Record<string, string>)?.authorization,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (status !== 201)
      return new Response(
        JSON.stringify({ error: { code: "forbidden", message: "This token can't scans:write." } }),
        { status },
      );
    return new Response(
      JSON.stringify({
        id: "s1",
        url: `${URL_}/acme/scans/s1`,
        org: { slug: "acme", name: "Acme" },
      }),
      { status: 201 },
    );
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch: respond };
}

async function cli(
  cwd: string,
  argv: string[],
  fetch = fakePlatform().fetch,
  env: Record<string, string> = {},
) {
  let stdout = "";
  let stderr = "";
  const io: IO = {
    cwd,
    env: { NO_COLOR: "1", GROUNDRULE_URL: URL_, ...env },
    stdout: {
      write: (t: string) => {
        stdout += t;
      },
    },
    stderr: {
      write: (t: string) => {
        stderr += t;
      },
    },
    fetch,
    configDir: join(cwd, ".no-credentials"),
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

describe("groundrule scan", () => {
  it("summarizes the repository and sends nothing", async () => {
    const root = await repo(APP);
    const platform = fakePlatform();
    const r = await cli(root, ["scan"], platform.fetch);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("groundrule scan · acme/web");
    expect(r.stdout).toMatch(/Stack\s+JavaScript, TypeScript, react/);
    expect(r.stdout).toMatch(/Agent files .*AGENTS\.md \(5 lines\)/);
    expect(r.stdout).toMatch(
      /Imports\s+2 instructions from agent files · 2 tool settings that match catalog rules · 2 CODEOWNERS entries/,
    );
    expect(r.stdout).toContain("Already enforced by your tools: TS-001, TS-007");
    expect(r.stdout).toContain("typescript (strict)");
    expect(r.stdout).toMatch(/! \d+ with findings/);
    expect(r.stdout).toContain("TS-001");
    expect(r.stdout).toContain("Nothing left this computer.");
    expect(r.stdout).not.toContain("DOCKER-");
    expect(platform.calls).toEqual([]);
  });

  it("prints a valid report with --json, and writes it with --output", async () => {
    const root = await repo(APP);
    const r = await cli(root, ["scan", "--json", "-o", "report.json"]);
    const report = ScanReport.parse(JSON.parse(r.stdout));
    expect(report.repository).toMatchObject({ name: "acme/web", branch: "main" });
    expect(report.agentFiles.map((f) => f.path)).toEqual(
      [".github/CODEOWNERS", "AGENTS.md", "CLAUDE.md"].filter((p) => p !== ".github/CODEOWNERS"),
    );
    expect(report.imports?.instructions.map((i) => i.text)).toEqual([
      "Small changes",
      "Never log tokens or personal data.",
    ]);
    expect(report.imports?.instructions[1]?.similar[0]?.id).toBe("SEC-006");
    expect(report.imports?.toolSettings.map((t) => [t.setting, t.standardId, t.stance])).toEqual(
      expect.arrayContaining([
        ["no-console", "TS-001", "enforced"],
        ["strict", "TS-007", "enforced"],
      ]),
    );
    expect(report.imports?.owners.map((o) => [o.pattern, o.category ?? null])).toEqual([
      ["*", null],
      ["/.github/workflows/", "ci"],
    ]);
    expect(report.rules.find((x) => x.id === "TS-001")).toMatchObject({
      outcome: "violations",
      examples: [
        expect.objectContaining({
          file: "src/app.ts",
          line: 1,
          snippet: expect.stringContaining("console.log"),
        }),
      ],
    });
    expect(JSON.parse(await readFile(join(root, "report.json"), "utf8"))).toEqual(report);
  });

  it("leaves imports out with --no-import", async () => {
    const root = await repo(APP);
    const report = JSON.parse((await cli(root, ["scan", "--json", "--no-import"])).stdout);
    expect(report.imports).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("personal data");
  });

  it("leaves code out with --no-snippets", async () => {
    const root = await repo(APP);
    const report = JSON.parse((await cli(root, ["scan", "--json", "--no-snippets"])).stdout);
    expect(report.metadata.snippets).toBe(false);
    expect(JSON.stringify(report)).not.toContain("console.log(");
  });

  it("uploads with --upload and prints the link", async () => {
    const root = await repo({
      ...APP,
      ".groundrule/config.yaml":
        "apiVersion: groundrule.dev/v1alpha1\nkind: Config\nplatform:\n  org: acme\n",
    });
    const platform = fakePlatform();
    const r = await cli(root, ["scan", "--upload"], platform.fetch, {
      GROUNDRULE_TOKEN: `grt_${"a".repeat(43)}`,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Uploaded to Acme: ${URL_}/acme/scans/s1`);
    expect(platform.calls).toHaveLength(1);
    expect(platform.calls[0]).toMatchObject({
      path: "/v1/cli/scans?org=acme",
      auth: `Bearer grt_${"a".repeat(43)}`,
    });
    expect(ScanReport.safeParse(platform.calls[0]?.body).success).toBe(true);
  });

  it("explains what to do when it can't upload", async () => {
    const root = await repo(APP);
    const notSignedIn = await cli(root, ["scan", "--upload"], fakePlatform().fetch);
    expect(notSignedIn.code).toBe(2);
    expect(notSignedIn.stderr).toContain("Not signed in");

    const readOnly = await cli(root, ["scan", "--upload"], fakePlatform(403).fetch, {
      GROUNDRULE_TOKEN: `grt_${"b".repeat(43)}`,
    });
    expect(readOnly.code).toBe(2);
    expect(readOnly.stderr).toContain("this token can't upload scans");
  });
});
