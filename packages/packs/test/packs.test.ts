import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadWorkspace, runChecks } from "@groundrule/core";
import { builtinEvaluators } from "@groundrule/evaluators";
import { afterEach, describe, expect, it } from "vitest";
import { listPacks, resolvePack } from "../src/index.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function audit(pack: string, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "groundrule-pack-"));
  dirs.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const all = {
    ".groundrule/config.yaml": `apiVersion: groundrule.dev/v1alpha1\nkind: Config\nextends: [groundrule:packs/${pack}]\n`,
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  const loaded = await loadWorkspace({ cwd: root, resolveRegistry: resolvePack });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const result = await runChecks({
    workspace: loaded.workspace,
    evaluators: builtinEvaluators,
    mode: "all",
  });
  expect(result.diagnostics).toEqual([]);
  const hits = (id: string) =>
    result.findings
      .filter((f) => f.standardId === id)
      .map((f) => `${f.location?.file ?? "repo"}:${f.location?.startLine ?? 0}`);
  return { result, hits };
}

describe("catalog", () => {
  it("lists every bundled pack", async () => {
    expect((await listPacks()).map((p) => [p.ref, p.standards])).toEqual([
      ["groundrule:packs/java-spring", 4],
      ["groundrule:packs/security-baseline", 6],
      ["groundrule:packs/typescript-node", 5],
    ]);
  });

  it("resolves only known names", () => {
    expect(resolvePack("packs/security-baseline")).toMatch(/catalog\/security-baseline$/);
    expect(resolvePack("packs/unknown")).toBeUndefined();
    expect(resolvePack("../etc")).toBeUndefined();
  });
});

describe("security-baseline", () => {
  it("catches keys, env files, tokens, and disabled TLS; stays quiet on clean code", async () => {
    const { hits, result } = await audit("security-baseline", {
      "deploy/key.pem": "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n",
      ".env": "DB_PASSWORD=hunter2\n",
      ".env.example": "DB_PASSWORD=\n",
      "tests/fixtures/app/.env": "FOO=fixture\n",
      "src/aws.ts": 'const id = "AKIAABCDEFGHIJKLMNOP";\n',
      "src/http.ts": "const agent = new Agent({ rejectUnauthorized: false });\n",
      "src/ok.ts": "export const ok = process.env.TOKEN;\n",
      "package.json": "{}\n",
    });
    expect(hits("SEC-001")).toEqual(["deploy/key.pem:1"]);
    expect(hits("SEC-002")).toEqual([".env:1"]);
    expect(hits("SEC-003")).toEqual(["src/aws.ts:1"]);
    expect(hits("SEC-004")).toEqual(["src/http.ts:1"]);
    expect(hits("SEC-005")).toEqual(["repo:0"]);
    expect(result.outcomes.find((o) => o.id === "SEC-006")?.status).toBe("guidance");
  });

  it("does not require a lockfile in repositories without those languages", async () => {
    const { result } = await audit("security-baseline", { "src/Main.java": "class Main {}\n" });
    expect(result.outcomes.find((o) => o.id === "SEC-005")?.status).toBe("skipped");
  });
});

describe("typescript-node", () => {
  it("flags console.log, eval, deprecated packages, and @ts-ignore, but not in tests", async () => {
    const { hits } = await audit("typescript-node", {
      "package.json": '{\n  "dependencies": {\n    "request": "^2.0.0"\n  }\n}\n',
      "src/app.ts":
        'console.log("x");\nconst f = new Function("a", "return a");\n// @ts-ignore\nlogger.log("fine");\n',
      "src/eval.ts": "const v = eval(input);\nconst ok = obj.evaluate(1);\n",
      "src/app.test.ts": 'console.log("tests may print");\n',
      "scripts/build.js": 'console.log("scripts may print");\n',
      "examples/hello/index.js": 'console.log("examples may print");\n',
    });
    expect(hits("TS-001")).toEqual(["src/app.ts:1"]);
    expect(hits("TS-002")).toEqual(["package.json:3"]);
    expect(hits("TS-003")).toEqual(["src/app.ts:2", "src/eval.ts:1"]);
    expect(hits("TS-004")).toEqual(["src/app.ts:3"]);
  });
});

describe("java-spring", () => {
  const pom =
    "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>\n";

  it("flags field injection, console output, and repositories in controllers", async () => {
    const { hits } = await audit("java-spring", {
      "pom.xml": pom,
      "src/main/java/app/ClaimService.java": [
        "class ClaimService {",
        "  @Autowired",
        "  private ClaimRepository claims;",
        '  @Autowired @Qualifier("x") private Map<String, Handler> handlers;',
        "  private final Clock clock;",
        "  @Autowired",
        "  ClaimService(Clock clock) { this.clock = clock; }",
        '  void f() { System.out.println("x"); e.printStackTrace(); }',
        "}",
      ].join("\n"),
      "src/main/java/app/web/ClaimController.java":
        "import app.repository.ClaimRepository;\nimport app.service.ClaimService;\n",
      // Package-by-feature (e.g. spring-petclinic): same package, no import, injected as a field.
      "src/main/java/app/owner/OwnerController.java":
        "class OwnerController {\n\n  private final OwnerRepository owners;\n  private final OwnerService service;\n  OwnerController(OwnerRepository owners) {}\n}\n",
      "src/test/java/app/ClaimServiceTest.java": "  @Autowired\n  private ClaimService service;\n",
    });
    expect(hits("JAVA-001")).toEqual([
      "src/main/java/app/ClaimService.java:2",
      "src/main/java/app/ClaimService.java:4",
    ]);
    expect(hits("JAVA-002")).toEqual([
      "src/main/java/app/ClaimService.java:8",
      "src/main/java/app/ClaimService.java:8",
    ]);
    expect(hits("JAVA-003")).toEqual([
      "src/main/java/app/owner/OwnerController.java:3",
      "src/main/java/app/web/ClaimController.java:1",
    ]);
  });

  it("skips Spring-only standards outside Spring Boot", async () => {
    const { result } = await audit("java-spring", { "src/main/java/A.java": "class A {}\n" });
    expect(result.outcomes.find((o) => o.id === "JAVA-001")?.status).toBe("skipped");
  });
});
