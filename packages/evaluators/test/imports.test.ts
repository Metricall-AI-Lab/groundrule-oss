// The imports evaluator (ADR 0009): layers, package gates and placeholders, over imports
// resolved through relative paths, tsconfig paths, npm workspaces and Python packages. What
// can't be resolved to the repository is a package, never a layer violation.
import type { EvaluatorFinding } from "@groundrule/core";
import { describe, expect, it } from "vitest";
import {
  importsEvaluator,
  scanGoImports,
  scanJavaImports,
  scanJsImports,
  scanPyImports,
} from "../src/index.js";
import { fakeContext, run } from "./helpers.js";

const summarize = (findings: readonly EvaluatorFinding[]) =>
  findings.map((f) => `${f.location?.file}:${f.location?.startLine} ${f.message}`).sort();

describe("scanning imports", () => {
  it("finds static imports, re-exports, require and dynamic import, not comments", () => {
    const text = `import a from "./a";
import { b } from './b.js'
export * from "../c";
// import nope from "./nope";
/* import also from "./also"; */
const d = require("d");
const e = await import("@scope/e/sub");
import "./side-effect";
const url = "https://example.com/not-an-import";
`;
    expect(scanJsImports(text)).toEqual([
      { specifier: "./a", line: 1 },
      { specifier: "./b.js", line: 2 },
      { specifier: "../c", line: 3 },
      { specifier: "d", line: 6 },
      { specifier: "@scope/e/sub", line: 7 },
      { specifier: "./side-effect", line: 8 },
    ]);
    expect(
      scanPyImports(
        "import os, sys as system\nfrom .models import User\nfrom app.infra import db  # comment\n# import nope\n",
      ),
    ).toEqual([
      { specifier: "os", line: 1 },
      { specifier: "sys", line: 1 },
      { specifier: ".models", line: 2 },
      { specifier: "app.infra", line: 3 },
    ]);
  });
});

describe("scanning Java, Kotlin and Go imports", () => {
  it("reads Java and Kotlin qualified names, static members dropped, wildcards kept", () => {
    const java = `package com.acme.shop.orders;

import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import com.acme.shop.infra.db.*;
// import com.acme.nope.Nope;
/* import com.acme.also.Also; */
import org.springframework.jdbc.core.JdbcTemplate;
`;
    expect(scanJavaImports(java)).toEqual([
      { specifier: "java.util.List", line: 3 },
      { specifier: "org.junit.jupiter.api.Assertions", line: 4 },
      { specifier: "com.acme.shop.infra.db.*", line: 5 },
      { specifier: "org.springframework.jdbc.core.JdbcTemplate", line: 8 },
    ]);
    expect(
      scanJavaImports("import com.acme.shop.domain.Money as M\nimport kotlinx.coroutines.*\n"),
    ).toEqual([
      { specifier: "com.acme.shop.domain.Money", line: 1 },
      { specifier: "kotlinx.coroutines.*", line: 2 },
    ]);
  });

  it("reads Go single imports and blocks, with aliases, blank and dot imports", () => {
    const go = `package orders

import "fmt"
import db "github.com/acme/shop/internal/infra/db"

import (
	"context"
	// "github.com/acme/nope"
	_ "github.com/lib/pq"
	. "github.com/acme/shop/internal/domain"
	stripe "github.com/stripe/stripe-go/v76"
)
`;
    expect(scanGoImports(go)).toEqual([
      { specifier: "fmt", line: 3 },
      { specifier: "github.com/acme/shop/internal/infra/db", line: 4 },
      { specifier: "context", line: 7 },
      { specifier: "github.com/lib/pq", line: 9 },
      { specifier: "github.com/acme/shop/internal/domain", line: 10 },
      { specifier: "github.com/stripe/stripe-go/v76", line: 11 },
    ]);
  });
});

describe("layer rules", () => {
  const files = {
    "src/domain/order.ts": `import { db } from "../infra/db/client";\nimport { Money } from "./money";\nimport type { Clock } from "../shared/clock";\n`,
    "src/domain/money.ts": "export class Money {}\n",
    "src/infra/db/client.ts": "export const db = {};\n",
    "src/shared/clock.ts": "export type Clock = {};\n",
    "src/api/orders.ts": `import { db } from "../infra/db/client";\nimport { Order } from "../domain/order";\n`,
  };

  it("report an import that crosses the boundary, with the line and the resolved path", async () => {
    const findings = await run(
      importsEvaluator,
      { from: ["src/domain/**"], forbid: ["src/infra/**", "src/api/**"] },
      fakeContext(files),
    );
    expect(summarize(findings)).toEqual([
      "src/domain/order.ts:1 src/domain/order.ts imports src/infra/db/client.ts: files in src/domain/** must not import src/infra/**, src/api/**",
    ]);
    expect(findings[0]).toMatchObject({
      status: "violation",
      confidence: "certain",
      evidence: [
        'src/domain/order.ts:1 imports "../infra/db/client", which resolves to src/infra/db/client.ts',
      ],
    });
  });

  it("respect allow lists, custom messages, and the standard's own scope", async () => {
    const findings = await run(
      importsEvaluator,
      {
        from: ["src/domain/**"],
        forbid: ["src/infra/**"],
        allow: ["src/infra/db/client.ts"],
        message: "Domain stays pure.",
      },
      fakeContext(files),
    );
    expect(findings).toEqual([]);
    const scoped = await run(
      importsEvaluator,
      { forbid: ["src/infra/**"], message: "No infra here.", remediation: "Inject it." },
      fakeContext(files, { targetFiles: ["src/domain/order.ts"] }),
    );
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ message: "No infra here.", remediation: "Inject it." });
  });

  it("resolve tsconfig paths and pnpm workspaces, and treat unknown bare names as packages", async () => {
    const repo = {
      "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"] } } }`,
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - '!packages/private/**'\n",
      "packages/db/package.json": `{ "name": "@acme/db" }`,
      "packages/db/src/index.ts": "export const db = 1;\n",
      "packages/db/src/internal/pool.ts": "export const pool = 1;\n",
      "src/infra/db.ts": "export const x = 1;\n",
      "src/domain/a.ts": `import x from "@app/infra/db";\nimport { pool } from "@acme/db/src/internal/pool";\nimport { db } from "@acme/db";\nimport z from "zod";\nimport u from "@unknown/alias";\n`,
    };
    const findings = await run(
      importsEvaluator,
      { from: ["src/domain/**"], forbid: ["src/infra/**", "packages/*/src/internal/**"] },
      fakeContext(repo, { targetFiles: ["src/domain/a.ts"] }),
    );
    expect(summarize(findings).map((s) => s.split(" ")[0])).toEqual([
      "src/domain/a.ts:1",
      "src/domain/a.ts:2",
    ]);
    // "zod" and an alias nobody declared are packages: a gate sees them, a layer rule doesn't.
    const gate = await run(
      importsEvaluator,
      { package: ["zod", "@unknown/*"], only: ["src/infra/**"] },
      fakeContext(repo, { targetFiles: ["src/domain/a.ts"] }),
    );
    expect(summarize(gate)).toEqual([
      "src/domain/a.ts:4 src/domain/a.ts imports zod: only src/infra/** may use it",
      "src/domain/a.ts:5 src/domain/a.ts imports @unknown/alias: only src/infra/** may use it",
    ]);
  });

  it("let a placeholder say that feature modules only reach each other through their index", async () => {
    const repo = {
      "src/features/billing/index.ts": "export const billing = 1;\n",
      "src/features/billing/internal/calc.ts": "export const calc = 1;\n",
      "src/features/orders/service.ts": `import { billing } from "../billing";\nimport { calc } from "../billing/internal/calc";\nimport { helper } from "./helper";\n`,
      "src/features/orders/helper.ts": "export const helper = 1;\n",
    };
    const findings = await run(
      importsEvaluator,
      {
        from: ["src/features/{feature}/**"],
        forbid: ["src/features/!({feature})/**"],
        allow: ["src/features/!({feature})/index.*"],
      },
      fakeContext(repo),
    );
    expect(summarize(findings)).toEqual([
      "src/features/orders/service.ts:2 src/features/orders/service.ts imports src/features/billing/internal/calc.ts: files in src/features/{feature}/** must not import src/features/!({feature})/**",
    ]);
  });

  it("understand Python packages, relative imports and gates", async () => {
    const repo = {
      "app/__init__.py": "",
      "app/domain/__init__.py": "",
      "app/domain/order.py":
        "from app.infra.db import session\nfrom .money import Money\nimport sqlalchemy\n",
      "app/domain/money.py": "class Money: ...\n",
      "app/infra/__init__.py": "",
      "app/infra/db.py": "import sqlalchemy\nsession = None\n",
    };
    const layer = await run(
      importsEvaluator,
      { from: ["app/domain/**"], forbid: ["app/infra/**"] },
      fakeContext(repo),
    );
    expect(summarize(layer)).toEqual([
      "app/domain/order.py:1 app/domain/order.py imports app/infra/db.py: files in app/domain/** must not import app/infra/**",
    ]);
    const gate = await run(
      importsEvaluator,
      { package: "sqlalchemy", only: ["app/infra/**"] },
      fakeContext(repo),
    );
    expect(summarize(gate)).toEqual([
      "app/domain/order.py:3 app/domain/order.py imports sqlalchemy: only app/infra/** may use it",
    ]);
  });

  it("resolve Java through source roots, nested classes and wildcards; gate JDBC by package", async () => {
    const repo = {
      "pom.xml": "<project/>",
      "src/main/java/com/acme/shop/domain/Order.java":
        "package com.acme.shop.domain;\n\nimport com.acme.shop.infra.db.OrderRow;\nimport com.acme.shop.infra.*;\nimport com.acme.shop.domain.Money.Cents;\nimport org.springframework.jdbc.core.JdbcTemplate;\nimport java.util.List;\n",
      "src/main/java/com/acme/shop/domain/Money.java":
        "package com.acme.shop.domain;\npublic class Money { public static class Cents {} }\n",
      "src/main/java/com/acme/shop/infra/Clock.java": "package com.acme.shop.infra;\n",
      "src/main/java/com/acme/shop/infra/db/OrderRow.java": "package com.acme.shop.infra.db;\n",
      "src/main/java/com/acme/shop/infra/db/Jdbc.kt":
        "package com.acme.shop.infra.db\n\nimport org.springframework.jdbc.core.JdbcTemplate\n",
      "src/test/java/com/acme/shop/domain/OrderTest.java":
        "package com.acme.shop.domain;\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\nimport com.acme.shop.infra.db.OrderRow;\n",
    };
    const layer = await run(
      importsEvaluator,
      { from: ["**/domain/**"], forbid: ["**/infra/**"] },
      fakeContext(repo),
    );
    expect(summarize(layer)).toEqual([
      "src/main/java/com/acme/shop/domain/Order.java:3 src/main/java/com/acme/shop/domain/Order.java imports src/main/java/com/acme/shop/infra/db/OrderRow.java: files in **/domain/** must not import **/infra/**",
      "src/main/java/com/acme/shop/domain/Order.java:4 src/main/java/com/acme/shop/domain/Order.java imports src/main/java/com/acme/shop/infra: files in **/domain/** must not import **/infra/**",
      "src/test/java/com/acme/shop/domain/OrderTest.java:4 src/test/java/com/acme/shop/domain/OrderTest.java imports src/main/java/com/acme/shop/infra/db/OrderRow.java: files in **/domain/** must not import **/infra/**",
    ]);
    // The nested class resolved to Money.java, inside the domain: no finding. java.util is a package.
    const gate = await run(
      importsEvaluator,
      { package: ["org.springframework.jdbc.*", "java.sql.*"], only: ["**/infra/**"] },
      fakeContext(repo),
    );
    expect(summarize(gate)).toEqual([
      "src/main/java/com/acme/shop/domain/Order.java:6 src/main/java/com/acme/shop/domain/Order.java imports org.springframework.jdbc.core.JdbcTemplate: only **/infra/** may use it",
    ]);
  });

  it("resolve Go through go.mod modules, nested modules included; gate a driver by import path", async () => {
    const repo = {
      "go.mod": "module github.com/acme/shop\n\ngo 1.22\n",
      "internal/domain/order.go":
        'package domain\n\nimport (\n\t"context"\n\t"github.com/acme/shop/internal/infra/db"\n\t"github.com/acme/shop/internal/domain/money"\n\t"github.com/lib/pq"\n)\n',
      "internal/domain/money/money.go": "package money\n",
      "internal/infra/db/db.go": 'package db\n\nimport _ "github.com/lib/pq"\n',
      "services/billing/go.mod": "module github.com/acme/billing\n",
      "services/billing/charge.go":
        'package billing\n\nimport (\n\t"github.com/acme/billing/stripe"\n\t"github.com/acme/shop/internal/domain"\n)\n',
      "services/billing/stripe/client.go":
        'package stripe\n\nimport stripe "github.com/stripe/stripe-go/v76"\n',
    };
    const layer = await run(
      importsEvaluator,
      { from: ["internal/domain/**"], forbid: ["internal/infra/**"] },
      fakeContext(repo),
    );
    expect(summarize(layer)).toEqual([
      "internal/domain/order.go:5 internal/domain/order.go imports internal/infra/db: files in internal/domain/** must not import internal/infra/**",
    ]);
    // The nested module resolves by its own path; the root module's package by the root's.
    const cross = await run(
      importsEvaluator,
      { from: ["services/billing/**"], forbid: ["internal/**"], allow: ["services/billing/**"] },
      fakeContext(repo),
    );
    expect(summarize(cross).map((s) => s.split(" ")[0])).toEqual(["services/billing/charge.go:5"]);
    const gate = await run(
      importsEvaluator,
      {
        package: ["github.com/lib/pq", "github.com/stripe/**"],
        only: ["internal/infra/**", "services/billing/stripe/**"],
      },
      fakeContext(repo),
    );
    expect(summarize(gate)).toEqual([
      "internal/domain/order.go:7 internal/domain/order.go imports github.com/lib/pq: only internal/infra/**, services/billing/stripe/** may use it",
    ]);
  });

  it("validate its options", () => {
    expect(() => importsEvaluator.optionsSchema.parse({ from: ["a/**"] })).toThrow(/forbid/);
    expect(() => importsEvaluator.optionsSchema.parse({ package: "stripe" })).toThrow(/only/);
    expect(() =>
      importsEvaluator.optionsSchema.parse({ forbid: ["b/**"], package: "x", only: ["a/**"] }),
    ).toThrow();
  });
});
