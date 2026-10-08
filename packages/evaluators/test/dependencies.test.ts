import { describe, expect, it } from "vitest";
import { dependenciesEvaluator, parseManifest } from "../src/index.js";
import { fakeContext, run } from "./helpers.js";

const packageJson = `{
  "name": "app",
  "dependencies": {
    "axios": "^1.7.0",
    "@aws-sdk/client-s3": "^3.0.0"
  },
  "devDependencies": {
    "request": "^2.88.0"
  }
}
`;

const pom = `<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.httpcomponents</groupId>
      <artifactId>httpclient</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>
`;

describe("parseManifest", () => {
  it("parses npm with line numbers", () => {
    expect(parseManifest("package.json", packageJson)).toEqual([
      { ecosystem: "npm", name: "axios", line: 4 },
      { ecosystem: "npm", name: "@aws-sdk/client-s3", line: 5 },
      { ecosystem: "npm", name: "request", line: 8 },
    ]);
  });

  it("parses Maven group:artifact", () => {
    expect(parseManifest("pom.xml", pom).map((d) => [d.name, d.line])).toEqual([
      ["org.apache.httpcomponents:httpclient", 5],
      ["org.springframework.boot:spring-boot-starter-web", 9],
    ]);
  });

  it("parses Gradle, requirements, pyproject, go.mod, and Cargo", () => {
    expect(
      parseManifest(
        "build.gradle.kts",
        'dependencies {\n  implementation("com.squareup.okhttp3:okhttp:4.12.0")\n}',
      ).map((d) => d.name),
    ).toEqual(["com.squareup.okhttp3:okhttp"]);
    expect(
      parseManifest(
        "requirements.txt",
        "# comment\nRequests==2.31\nurllib3>=2 ; python_version>'3'\n-r other.txt\n",
      ).map((d) => d.name),
    ).toEqual(["requests", "urllib3"]);
    expect(
      parseManifest(
        "pyproject.toml",
        '[project]\nname = "x"\ndependencies = [\n  "httpx>=0.27",\n  "Flask_Login",\n]\n[tool.poetry.dependencies]\npython = "^3.12"\nrequests = "^2"\n',
      ).map((d) => d.name),
    ).toEqual(["httpx", "flask-login", "requests"]);
    expect(
      parseManifest(
        "go.mod",
        "module x\n\nrequire (\n\tgithub.com/pkg/errors v0.9.1\n)\nrequire golang.org/x/net v0.1.0\n",
      ).map((d) => d.name),
    ).toEqual(["github.com/pkg/errors", "golang.org/x/net"]);
    expect(
      parseManifest(
        "Cargo.toml",
        '[package]\nname="x"\n[dependencies]\nserde = "1"\n[dev-dependencies.tokio]\nversion="1"\n',
      ).map((d) => d.name),
    ).toEqual(["serde", "tokio"]);
  });

  it("ignores invalid JSON", () => {
    expect(parseManifest("package.json", "{ not json")).toEqual([]);
  });
});

describe("dependencies", () => {
  const ctx = fakeContext({
    "package.json": packageJson,
    "services/api/pom.xml": pom,
    "src/index.ts": "",
  });

  it("flags forbidden npm packages with location and remediation", async () => {
    const findings = await run(
      dependenciesEvaluator,
      { forbid: ["axios", "request"], allowInstead: ["@acme/http-client"] },
      ctx,
    );
    expect(findings.map((f) => [f.location?.startLine, f.message])).toEqual([
      [4, 'Forbidden dependency "axios"'],
      [8, 'Forbidden dependency "request"'],
    ]);
    expect(findings[0]?.remediation).toBe("Use @acme/http-client instead.");
  });

  it("matches scoped globs", async () => {
    const findings = await run(dependenciesEvaluator, { forbid: ["@aws-sdk/*"] }, ctx);
    expect(findings.map((f) => f.snippet)).toEqual(["npm:@aws-sdk/client-s3"]);
  });

  it("matches Maven by artifact or group:artifact", async () => {
    expect(await run(dependenciesEvaluator, { forbid: ["httpclient"] }, ctx)).toHaveLength(1);
    expect(
      await run(dependenciesEvaluator, { forbid: ["org.apache.httpcomponents:*"] }, ctx),
    ).toHaveLength(1);
  });

  it("filters by ecosystem", async () => {
    expect(
      await run(
        dependenciesEvaluator,
        { forbid: ["httpclient", "axios"], ecosystems: ["npm"] },
        ctx,
      ),
    ).toHaveLength(1);
  });

  it("only scans target files", async () => {
    const changed = fakeContext({ "package.json": packageJson }, { targetFiles: [] });
    expect(await run(dependenciesEvaluator, { forbid: ["axios"] }, changed)).toEqual([]);
  });
});
