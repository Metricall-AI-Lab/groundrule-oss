// Milestone 1 gate (Build Plan §4.5): the four deliberately different foundation
// standards run end to end through one pipeline, with no special cases.
//   DEP-008  deterministic   (dependencies)
//   AUTH-017 static + AI     (semgrep + llm; llm not evaluable until 0.2)
//   PROC-004 process         (change-set)
//   AI-003   agent-only      (no checks)
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace, runChecks } from "@groundrule/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinEvaluators, semgrepRuntime } from "../src/index.js";

const FOUNDATION = fileURLToPath(
  new URL("../../../examples/foundation/.groundrule", import.meta.url),
);

const controller = (extra = "") => `package claims;

@RestController
public class ClaimController {
  @PreAuthorize("hasPermission(#id, 'claim', 'read')")
  @GetMapping("/claims/{id}")
  public ClaimDto get(@PathVariable UUID id) { return service.get(id); }
${extra}}
`;

let root: string;
let semgrepArgs: string[] = [];
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
const write = async (rel: string, content: string) => {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "groundrule-foundation-"));
  git("init", "-q", "-b", "main");
  await cp(FOUNDATION, join(root, ".groundrule"), { recursive: true });
  await write(
    "package.json",
    '{\n  "name": "claims-web",\n  "dependencies": {\n    "express": "^5.0.0"\n  }\n}\n',
  );
  await write(
    "services/legacy-billing/package.json",
    '{\n  "name": "billing",\n  "dependencies": {\n    "axios": "^1.0.0"\n  }\n}\n',
  );
  await write(
    "pom.xml",
    "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>\n",
  );
  await write("src/main/java/claims/ClaimController.java", controller());
  await write(
    "src/main/java/claims/entity/Claim.java",
    "package claims.entity;\npublic class Claim {\n  String status;\n}\n",
  );
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  // The change under review: a new dependency, an unprotected endpoint, and an entity change without a migration.
  await write(
    "package.json",
    '{\n  "name": "claims-web",\n  "dependencies": {\n    "express": "^5.0.0",\n    "axios": "^1.7.0"\n  }\n}\n',
  );
  await write(
    "services/legacy-billing/package.json",
    '{\n  "name": "billing",\n  "private": true,\n  "dependencies": {\n    "axios": "^1.0.0"\n  }\n}\n',
  );
  await write(
    "src/main/java/claims/ClaimController.java",
    controller(
      '\n  @PostMapping("/claims/{id}/approve")\n  public ClaimDto approve(@PathVariable UUID id) { return service.approve(id); }\n',
    ),
  );
  await write(
    "src/main/java/claims/entity/Claim.java",
    "package claims.entity;\npublic class Claim {\n  String status;\n  Instant approvedAt;\n}\n",
  );

  // Semgrep is optional tooling; stand in for it so the gate runs everywhere.
  semgrepRuntime.binary = process.execPath;
  semgrepRuntime.resetAvailability();
  semgrepRuntime.run = async (args) => {
    semgrepArgs = args;
    return JSON.stringify({
      results: [
        {
          check_id: "auth-017-mutating-endpoint-without-preauthorize",
          path: "src/main/java/claims/ClaimController.java",
          start: { line: 10 },
          end: { line: 11 },
          extra: {
            message: "State-changing endpoint without @PreAuthorize.",
            lines: '@PostMapping("/claims/{id}/approve")',
          },
        },
      ],
      errors: [],
    });
  };
});

afterAll(async () => {
  semgrepRuntime.binary = "semgrep";
  semgrepRuntime.resetAvailability();
  await rm(root, { recursive: true, force: true });
});

async function run(mode: "changes" | "all") {
  const loaded = await loadWorkspace({ cwd: root });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));
  return runChecks({
    workspace: loaded.workspace,
    evaluators: builtinEvaluators,
    mode,
    now: new Date("2026-10-07"),
  });
}

describe("foundation gate", () => {
  it("evaluates all four standards on a pull-request-style change", async () => {
    const result = await run("changes");
    expect(result.diagnostics).toEqual([]);
    expect(Object.fromEntries(result.outcomes.map((o) => [o.id, o.status]))).toEqual({
      "AI-003": "guidance",
      "AUTH-017": "failed",
      "DEP-008": "warned",
      "PROC-004": "failed",
    });
    expect(result.failed).toBe(true);
    expect(result.context).toMatchObject({
      languages: ["java"],
      frameworks: ["express", "spring-boot"],
    });
  });

  it("DEP-008 flags the new dependency and honors the legacy-billing exception", async () => {
    const result = await run("changes");
    const dep = result.findings.filter((f) => f.standardId === "DEP-008");
    expect(
      dep.map((f) => [f.location?.file, f.location?.startLine, f.isNew, f.suppressedBy]),
    ).toEqual([
      ["package.json", 5, true, undefined],
      // Unchanged line in a changed file: legacy, and covered by the exception anyway.
      ["services/legacy-billing/package.json", 5, false, "EX-1042"],
    ]);
    expect(dep[0]).toMatchObject({
      source: "deterministic",
      severity: "warning",
      remediation: "Use @acme/http-client instead.",
    });
  });

  it("AUTH-017 runs Semgrep with the rule file next to the standard, and says the AI check is coming", async () => {
    const result = await run("changes");
    const config = semgrepArgs[semgrepArgs.indexOf("--config") + 1];
    expect(config?.endsWith(".groundrule/rules/auth-017.yaml")).toBe(true);
    // Only changed files inside the standard's scope (src/main/**) are scanned.
    expect(semgrepArgs.slice(semgrepArgs.indexOf("--") + 1)).toEqual([
      "src/main/java/claims/ClaimController.java",
      "src/main/java/claims/entity/Claim.java",
    ]);
    const auth = result.findings.find((f) => f.standardId === "AUTH-017");
    expect(auth).toMatchObject({
      source: "static-analysis",
      severity: "blocker",
      isNew: true,
      location: { startLine: 10 },
    });
    expect(result.outcomes.find((o) => o.id === "AUTH-017")?.reason).toMatch(
      /AI checks arrive in Groundrule 0.2/,
    );
  });

  it("PROC-004 flags the entity change without a migration", async () => {
    const result = await run("changes");
    const proc = result.findings.find((f) => f.standardId === "PROC-004");
    expect(proc).toMatchObject({
      severity: "blocker",
      isNew: true,
      location: { file: "src/main/java/claims/entity/Claim.java", startLine: 4 },
    });
  });

  it("a full audit evaluates everything, and PROC-004 explains it needs a change", async () => {
    const result = await run("all");
    expect(result.outcomes.find((o) => o.id === "PROC-004")).toMatchObject({
      status: "not-evaluable",
      reason: "Needs a change to compare. Run in a pull request or with --base.",
    });
  });
});
