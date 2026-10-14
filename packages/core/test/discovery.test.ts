// Architecture discovery (RFC 0011): boundaries and package gates a repository already keeps,
// read from its import graph, with the files that would fail each proposed rule today.
import { describe, expect, it } from "vitest";
import { buildImportGraph, discoverArchitecture, moduleOf } from "../src/index.js";

/** A repository as files; `read` serves them the way the scan does. */
async function discover(files: Record<string, string>) {
  const names = Object.keys(files);
  const { edges } = await buildImportGraph(names, async (p) => files[p]);
  return discoverArchitecture(names, edges);
}

const layered = (() => {
  const files: Record<string, string> = {};
  // Domain: pure, many files; infra and api depend on it.
  for (let i = 0; i < 4; i++) files[`src/domain/d${i}.ts`] = `export const d${i} = ${i};\n`;
  for (let i = 0; i < 4; i++)
    files[`src/infra/i${i}.ts`] =
      `import { d${i} } from "../domain/d${i}";\nimport { Pool } from "pg";\n`;
  for (let i = 0; i < 3; i++)
    files[`src/api/a${i}.ts`] =
      `import { d${i} } from "../domain/d${i}";\nimport { i${i} } from "../infra/i${i}";\n`;
  // One leak: the domain reaching into infra.
  files["src/domain/leak.ts"] = `import { i0 } from "../infra/i0";\n`;
  // Payments uses stripe from three files; one other file does too (one stray use is tolerated).
  for (let i = 0; i < 3; i++) files[`src/payments/p${i}.ts`] = `import Stripe from "stripe";\n`;
  files["src/api/a2.ts"] += `import Stripe from "stripe";\n`;
  files["package.json"] = "{}";
  return files;
})();

describe("moduleOf", () => {
  it("names the module a file belongs to", () => {
    expect(moduleOf("src/domain/order.ts")).toBe("src/domain");
    expect(moduleOf("src/index.ts")).toBeNull();
    expect(moduleOf("packages/db/src/client.ts")).toBe("packages/db");
    expect(moduleOf("packages/db")).toBe("packages/db");
    expect(moduleOf("apps/web/src/features/billing/x.ts")).toBe("apps/web/src/features");
    expect(moduleOf("app/models/user.py")).toBe("app/models");
    expect(moduleOf("README.md")).toBeNull();
    expect(moduleOf("scripts/build.ts")).toBe("scripts");
  });
});

describe("discoverArchitecture", () => {
  it("proposes the boundaries the code keeps, with evidence and today's violations", async () => {
    const { boundaries, gates } = await discover(layered);
    expect(boundaries.map((b) => [b.from, b.forbid, b.importsBack, b.violations])).toEqual([
      ["src/domain", "src/infra", 4, 1],
      ["src/domain", "src/api", 3, 0],
      ["src/infra", "src/api", 3, 0],
    ]);
    expect(boundaries[0]).toMatchObject({
      files: 5,
      examples: [{ file: "src/domain/leak.ts", line: 1, target: "src/infra/i0.ts" }],
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(gates.map((g) => [g.package, g.only, g.users, g.violations])).toEqual([
      ["pg", "src/infra", 4, 0],
      ["stripe", "src/payments", 3, 1],
    ]);
  });

  it("never pairs a module with its own parent", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 3; i++) {
      files[`apps/api/src/routes/r${i}.ts`] = "export {};\n";
      files[`apps/api/test/t${i}.ts`] = `import "../src/routes/r${i}";\n`;
    }
    files["apps/api/src/index.ts"] = `import "./routes/r0";\n`;
    const { boundaries } = await discover(files);
    expect(boundaries).toEqual([]);
  });

  it("keeps the rule between parents when it covers one between subdirectories", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 3; i++) {
      files[`packages/core/src/c${i}.ts`] = "export {};\n";
      files[`packages/cli/src/commands/k${i}.ts`] = `import "../../../core/src/c${i}";\n`;
      files[`packages/cli/src/x${i}.ts`] = `import "../../core/src/c${i}";\n`;
    }
    const { boundaries } = await discover(files);
    expect(boundaries.map((b) => [b.from, b.forbid])).toEqual([["packages/core", "packages/cli"]]);
  });

  it("proposes nothing where imports go both ways or modules are tiny", async () => {
    const { boundaries, gates } = await discover({
      "src/a/1.ts": `import "../b/1";\n`,
      "src/a/2.ts": `import "../b/2";\n`,
      "src/a/3.ts": `import "../b/3";\n`,
      "src/b/1.ts": `import "../a/1";\n`,
      "src/b/2.ts": `import "../a/2";\n`,
      "src/b/3.ts": `import "../a/3";\n`,
      "src/tiny/x.ts": `import "../a/1";\n`,
      "src/c/1.ts": `import axios from "axios";\n`,
      "src/c/2.ts": `import axios from "axios";\n`,
      "src/c/3.ts": "",
      "src/a/4.ts": `import axios from "axios";\n`,
    });
    expect(boundaries).toEqual([]);
    // axios: two users in c, one elsewhere — not one module's package.
    expect(gates).toEqual([]);
  });

  it("gates a package used from one module with one stray use", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++)
      files[`src/db/${i}.ts`] = `import { PrismaClient } from "@prisma/client";\n`;
    for (let i = 0; i < 3; i++) files[`src/web/${i}.ts`] = "export {};\n";
    files["src/web/2.ts"] = `import { PrismaClient } from "@prisma/client";\n`;
    const { gates } = await discover(files);
    expect(gates).toEqual([
      expect.objectContaining({
        package: "@prisma/client",
        only: "src/db",
        users: 6,
        violations: 1,
        examples: [{ file: "src/web/2.ts", line: 1 }],
      }),
    ]);
  });

  it("understands Python packages", async () => {
    const files: Record<string, string> = { "app/__init__.py": "" };
    for (const m of ["domain", "infra", "api"]) files[`app/${m}/__init__.py`] = "";
    for (let i = 0; i < 3; i++) {
      files[`app/domain/d${i}.py`] = "x = 1\n";
      files[`app/infra/i${i}.py`] = `from app.domain.d${i} import x\nimport sqlalchemy\n`;
      files[`app/api/a${i}.py`] = `from app.domain import d${i}\nfrom app.infra import i${i}\n`;
    }
    const { boundaries, gates } = await discover(files);
    expect(boundaries.map((b) => [b.from, b.forbid])).toEqual([
      ["app/domain", "app/api"],
      ["app/domain", "app/infra"],
      ["app/infra", "app/api"],
    ]);
    expect(gates.map((g) => [g.package, g.only, g.users])).toEqual([
      ["sqlalchemy", "app/infra", 3],
    ]);
  });
});
