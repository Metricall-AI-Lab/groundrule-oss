// The CLI against the Groundrule platform (A5): `login` (device flow), `whoami`,
// `logout`, and `sync`/`check`/`init` with `platform:` in the config. The platform is a
// fake in this file; nothing touches the network or your real credentials.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type IO, run } from "../src/index.js";
import { platformUrl, repositoryFromRemote } from "../src/platform.js";

const URL_ = "https://app.groundrule.test";
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function temp(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function repo(files: Record<string, string> = {}, remote?: string) {
  const root = await temp("groundrule-platform-");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: root });
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  return root;
}

const standard = (id: string, overrides: Record<string, unknown> = {}) => ({
  apiVersion: "groundrule.dev/v1alpha1",
  kind: "Standard",
  metadata: { id, title: `Rule ${id}`, type: "forbidden-tech", owner: "team:platform" },
  spec: {
    severity: "blocker",
    intent: "One HTTP client means one place for retries and tracing.",
    requirement: `Follow ${id}: use the shared HTTP client, not axios.`,
    remediation: "Replace axios with the shared client.",
    checks: [{ evaluator: "dependencies", forbid: ["axios"] }],
    ...overrides,
  },
});

interface Fake {
  calls: { method: string; path: string; auth: string | undefined; body: unknown }[];
  /** Responses for POST /v1/cli/login/token, in order. */
  polls: object[];
  rulebook: object;
  revoked: string[];
  fetch: typeof fetch;
}

/** A tiny stand-in for the platform API. */
function fakePlatform(options: { org?: string; token?: string } = {}): Fake {
  const org = options.org ?? "acme";
  const token = options.token ?? `grt_${"a".repeat(43)}`;
  const fake: Fake = {
    calls: [],
    polls: [
      { error: { code: "authorization_pending" } },
      { error: { code: "slow_down" } },
      { token, org: { slug: org, name: "Acme" }, user: { email: "ada@acme.test", name: "Ada" } },
    ],
    revoked: [],
    rulebook: {
      org: { slug: org, name: "Acme", codingAgents: ["claude_code", "cursor"] },
      target: { level: "organization", team: null, repository: null },
      repositoryKnown: false,
      generatedAt: new Date().toISOString(),
      standards: [
        { stage: "enforce", origin: "organization", document: standard("ORG-001") },
        {
          stage: "advise",
          origin: "groundrule:packs/http-api",
          document: standard("ORG-002", {
            checks: [{ evaluator: "dependencies", forbid: ["got"] }],
          }),
        },
        {
          stage: "teach",
          origin: "organization",
          document: standard("ORG-003", {
            checks: [{ evaluator: "dependencies", forbid: ["left-pad"] }],
          }),
        },
      ],
    },
    fetch: (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace(/^\/api/, "");
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      fake.calls.push({ method: init?.method ?? "GET", path: `${path}${url.search}`, auth, body });
      const json = (status: number, payload: unknown) =>
        new Response(JSON.stringify(payload), { status });
      const live = (header: string | undefined) =>
        header?.startsWith("Bearer grt_") && !fake.revoked.includes(header.slice(7));
      if (path === "/v1/cli/login")
        return json(200, {
          deviceCode: "d".repeat(43),
          userCode: "WDJB-MJHT",
          verificationUri: `${URL_}/cli/activate`,
          verificationUriComplete: `${URL_}/cli/activate?code=WDJB-MJHT`,
          expiresIn: 600,
          interval: 5,
        });
      if (path === "/v1/cli/login/token") {
        const next = fake.polls.shift() ?? { error: { code: "invalid_grant" } };
        return json("error" in next ? 400 : 200, next);
      }
      if (!live(auth)) return json(401, { error: { code: "invalid_token", message: "nope" } });
      if (path === "/v1/cli/token" && init?.method === "DELETE") {
        fake.revoked.push(String(auth).slice(7));
        return json(200, { ok: true });
      }
      if (path === "/v1/cli/whoami")
        return json(200, {
          org: { slug: org, name: "Acme" },
          user: { email: "ada@acme.test", name: "Ada" },
          token: {
            name: "CLI login · groundrule on test",
            prefix: token.slice(0, 12),
            expiresAt: null,
          },
        });
      if (path === "/v1/cli/rulebook") return json(200, fake.rulebook);
      return json(404, { error: { code: "not_found", message: "no route" } });
    }) as unknown as typeof fetch,
  };
  return fake;
}

async function cli(
  cwd: string,
  fake: Fake,
  configDir: string,
  argv: string[],
  env: Record<string, string> = {},
) {
  let stdout = "";
  let stderr = "";
  const opened: string[] = [];
  const io: IO = {
    cwd,
    env: { NO_COLOR: "1", GROUNDRULE_URL: URL_, ...env },
    stdout: {
      write: (t: string) => {
        stdout += t;
      },
      isTTY: true,
    },
    stderr: {
      write: (t: string) => {
        stderr += t;
      },
    },
    fetch: fake.fetch,
    sleep: async () => {},
    openUrl: async (url) => {
      opened.push(url);
      return true;
    },
    hostname: "ada-mbp",
    configDir,
  };
  const code = await run(argv, io);
  return { code, stdout, stderr, opened };
}

const PLATFORM_CONFIG = [
  "apiVersion: groundrule.dev/v1alpha1",
  "kind: Config",
  "platform:",
  "  org: acme",
  "targets: [agents-md]",
  "",
].join("\n");

const APP = {
  "package.json": '{ "name": "app", "dependencies": { "got": "^14.0.0" } }\n',
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
};

describe("platform address", () => {
  const io = (env: Record<string, string> = {}) =>
    ({ cwd: "/", env, stdout: { write() {} }, stderr: { write() {} } }) as IO;
  it("defaults to app.groundrule.dev and only allows http for localhost", () => {
    expect(platformUrl(io())).toBe("https://app.groundrule.dev");
    expect(platformUrl(io(), "http://localhost:5173/")).toBe("http://localhost:5173");
    expect(() => platformUrl(io(), "http://groundrule.example")).toThrow(/use https/);
    expect(() => platformUrl(io({ GROUNDRULE_URL: "nope" }))).toThrow(/isn't a valid URL/);
  });

  it.each([
    ["git@github.com:acme/payments-api.git", "acme/payments-api"],
    ["https://github.com/acme/payments-api.git", "acme/payments-api"],
    ["https://github.com/acme/payments-api/", "acme/payments-api"],
    ["ssh://git@gitlab.com/acme/platform/api.git", "acme/platform/api"],
    ["https://user@dev.azure.com/acme/proj/_git/api", "acme/proj/_git/api"],
    ["not a url", undefined],
  ])("reads the repository from %s", (remote, name) => {
    expect(repositoryFromRemote(remote)).toBe(name);
  });
});

describe("groundrule login", () => {
  it("shows a code, opens the browser, waits for approval, and saves a private token", async () => {
    const fake = fakePlatform();
    const home = await temp("groundrule-home-");
    const r = await cli(await repo(), fake, home, ["login"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Your one-time code:  WDJB-MJHT");
    expect(r.opened).toEqual([`${URL_}/cli/activate?code=WDJB-MJHT`]);
    expect(r.stdout).toContain("Signed in to Acme (acme) as ada@acme.test");
    expect(r.stdout).toContain("groundrule init --org acme");
    expect(fake.calls[0]).toMatchObject({
      path: "/v1/cli/login",
      body: { clientName: "groundrule on ada-mbp" },
    });
    expect(fake.calls.filter((c) => c.path === "/v1/cli/login/token")).toHaveLength(3);

    const file = join(home, "credentials.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.hosts[URL_].orgs.acme).toMatchObject({ org: "acme", user: "ada@acme.test" });
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("revokes the previous login for the same organization", async () => {
    const home = await temp("groundrule-home-");
    const root = await repo();
    const first = fakePlatform({ token: `grt_${"1".repeat(43)}` });
    await cli(root, first, home, ["login"]);
    const second = fakePlatform({ token: `grt_${"2".repeat(43)}` });
    await cli(root, second, home, ["login"]);
    expect(second.revoked).toEqual([`grt_${"1".repeat(43)}`]);
  });

  it("saves nothing when the request is declined", async () => {
    const fake = fakePlatform();
    fake.polls = [{ error: { code: "access_denied" } }];
    const home = await temp("groundrule-home-");
    const r = await cli(await repo(), fake, home, ["login", "--no-browser"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("declined");
    expect(r.opened).toEqual([]);
    await expect(readFile(join(home, "credentials.json"), "utf8")).rejects.toThrow();
  });

  it("refuses to send anything to a plain-http remote", async () => {
    const fake = fakePlatform();
    const r = await cli(await repo(), fake, await temp("h-"), [
      "login",
      "--url",
      "http://evil.test",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("use https");
    expect(fake.calls).toEqual([]);
  });
});

describe("whoami and logout", () => {
  it("shows the signed-in organization, then signs out and revokes", async () => {
    const fake = fakePlatform();
    const home = await temp("groundrule-home-");
    const root = await repo({ ".groundrule/config.yaml": PLATFORM_CONFIG });
    await cli(root, fake, home, ["login"]);

    const who = await cli(root, fake, home, ["whoami"]);
    expect(who.code).toBe(0);
    expect(who.stdout).toContain("Acme (acme) as ada@acme.test");
    expect(who.stdout).toContain("This repository uses acme.");

    const out = await cli(root, fake, home, ["logout"]);
    expect(out.stdout).toContain("Signed out of Acme (acme)");
    expect(fake.revoked).toHaveLength(1);
    expect((await cli(root, fake, home, ["whoami"])).code).toBe(1);
  });
});

describe("sync and check with platform:", () => {
  async function connected() {
    const fake = fakePlatform();
    const home = await temp("groundrule-home-");
    const root = await repo(
      {
        ".groundrule/config.yaml": PLATFORM_CONFIG,
        ".groundrule/standards/LOCAL-001.yaml": JSON.stringify(
          standard("LOCAL-001", { checks: [] }),
        ),
        ...APP,
      },
      "git@github.com:acme/payments-api.git",
    );
    await cli(root, fake, home, ["login"]);
    return { fake, home, root };
  }

  it("writes the organization's rules (Teach and above) plus the repository's own", async () => {
    const { fake, home, root } = await connected();
    const sync = await cli(root, fake, home, ["sync"]);
    expect(sync.code).toBe(0);
    expect(sync.stdout).toContain("From Acme on Groundrule (organization rules)");
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    for (const id of ["ORG-001", "ORG-002", "ORG-003", "LOCAL-001"]) expect(agents).toContain(id);
    const rulebookCall = fake.calls.find((c) => c.path.startsWith("/v1/cli/rulebook"));
    expect(rulebookCall?.path).toBe("/v1/cli/rulebook?repository=acme%2Fpayments-api");
    expect(sync.stderr).toContain("acme/payments-api isn't registered in acme");
    expect((await cli(root, fake, home, ["sync", "--check"])).code).toBe(0);
  });

  it("checks Enforce rules as set, Advise rules as warnings, and skips Teach rules", async () => {
    const { fake, home, root } = await connected();
    const json = await cli(root, fake, home, ["check", "--all", "--format", "json"]);
    const report = JSON.parse(json.stdout);
    const findings = report.findings.map((f: { standardId: string; severity: string }) => [
      f.standardId,
      f.severity,
    ]);
    expect(findings).toEqual([["ORG-002", "warning"]]);
    expect(json.code).toBe(0);

    // Promote ORG-002 to Enforce on the platform: now it blocks.
    (fake.rulebook as { standards: { stage: string }[] }).standards[1] = {
      ...(fake.rulebook as { standards: object[] }).standards[1],
      stage: "enforce",
    } as { stage: string };
    expect((await cli(root, fake, home, ["check", "--all"])).code).toBe(1);
  });

  it("uses GROUNDRULE_TOKEN in CI", async () => {
    const fake = fakePlatform();
    const root = await repo({ ".groundrule/config.yaml": PLATFORM_CONFIG, ...APP });
    const r = await cli(root, fake, await temp("h-"), ["sync"], {
      GROUNDRULE_TOKEN: `grt_${"a".repeat(43)}`,
    });
    expect(r.code).toBe(0);
    expect(fake.calls.at(-1)?.auth).toBe(`Bearer grt_${"a".repeat(43)}`);
  });

  it("explains what to do when not signed in or the token is dead", async () => {
    const fake = fakePlatform();
    const root = await repo({ ".groundrule/config.yaml": PLATFORM_CONFIG, ...APP });
    const none = await cli(root, fake, await temp("h-"), ["sync"]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("Not signed in to acme");
    expect(none.stderr).toContain("groundrule login");

    const revoked = `grt_${"z".repeat(43)}`;
    fake.revoked.push(revoked);
    const dead = await cli(root, fake, await temp("h-"), ["check"], {
      GROUNDRULE_TOKEN: revoked,
    });
    expect(dead.code).toBe(2);
    expect(dead.stderr).toContain("GROUNDRULE_TOKEN isn't valid");
  });

  it("refuses a token for a different organization", async () => {
    const fake = fakePlatform({ org: "globex" });
    const root = await repo({ ".groundrule/config.yaml": PLATFORM_CONFIG, ...APP });
    const r = await cli(root, fake, await temp("h-"), ["sync"], {
      GROUNDRULE_TOKEN: `grt_${"a".repeat(43)}`,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("This token is for globex, but this repository uses acme");
  });

  it("skips documents this CLI can't validate, and ignores extends", async () => {
    const fake = fakePlatform();
    (fake.rulebook as { standards: object[] }).standards.push({
      stage: "enforce",
      origin: "organization",
      document: { kind: "Standard", metadata: { id: "BAD-001" } },
    });
    const root = await repo({
      ".groundrule/config.yaml": `${PLATFORM_CONFIG}extends: [groundrule:packs/security-baseline]\n`,
      ...APP,
    });
    const r = await cli(root, fake, await temp("h-"), ["standards", "--json"], {
      GROUNDRULE_TOKEN: `grt_${"a".repeat(43)}`,
    });
    expect(r.stderr).toContain("Skipped BAD-001");
    expect(r.stderr).toContain("Ignored because `platform` is set");
    const ids = JSON.parse(r.stdout).map((s: { id: string; stage?: string }) => [s.id, s.stage]);
    expect(ids).toEqual(
      expect.arrayContaining([
        ["ORG-001", "enforce"],
        ["ORG-003", "teach"],
      ]),
    );
    expect(ids.some(([id]: [string]) => id.startsWith("SEC-"))).toBe(false);
  });
});

describe("groundrule init --org", () => {
  it("connects the repository and picks agent files from the organization's agents", async () => {
    const fake = fakePlatform();
    const home = await temp("groundrule-home-");
    const root = await repo(APP);
    await cli(root, fake, home, ["login"]);
    const r = await cli(root, fake, home, ["init", "--org", "acme"]);
    expect(r.code).toBe(0);
    const config = await readFile(join(root, ".groundrule/config.yaml"), "utf8");
    expect(config).toContain("platform:\n  org: acme\n  url: https://app.groundrule.test");
    expect(config).not.toContain("extends:");
    expect(config).toContain("- claude-code");
    expect(config).toContain("- cursor");
    expect((await cli(root, fake, home, ["sync"])).code).toBe(0);
  });

  it("asks you to log in when you aren't, and rejects bad input", async () => {
    const fake = fakePlatform();
    const home = await temp("groundrule-home-");
    const root = await repo(APP);
    const r = await cli(root, fake, home, ["init", "--org", "acme"]);
    expect(r.stdout).toContain("groundrule login");
    expect((await cli(root, fake, home, ["init", "--org", "Not Valid!", "--force"])).code).toBe(2);
    expect(
      (await cli(root, fake, home, ["init", "--org", "acme", "--packs", "go", "--force"])).code,
    ).toBe(2);
  });
});
