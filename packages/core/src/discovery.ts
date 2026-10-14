// Architecture discovery (RFC 0011): the boundaries a repository already keeps, read from its
// import graph, as proposals with their evidence. A boundary is proposed only where the code
// shows a direction: one module imports another often, and the reverse happens never or
// rarely. A package gate is proposed where a package that deserves one owner (payments,
// databases, HTTP clients, cloud SDKs) is used from one module only, or nearly so.

import { createHash } from "node:crypto";
import { dirOf, type ImportEdge, isJsFile, isPyFile } from "./import-graph.js";

/** Directories whose children are modules, rather than modules themselves. */
const SOURCE_ROOTS = ["src", "app", "lib", "source"];
const WORKSPACE_ROOTS = ["packages", "apps", "libs", "services", "modules"];
/** Files a module needs before it counts; smaller directories are noise. */
const MIN_MODULE_FILES = 3;
/** Imports in the dominant direction before a boundary is proposed. */
const MIN_DIRECTION = 3;
/** The reverse direction may have this share of the dominant one (rounded down, at least one file) and still be proposed. */
const MAX_REVERSE_SHARE = 0.2;
const tolerated = (n: number) => Math.max(1, Math.floor(n * MAX_REVERSE_SHARE));
const MAX_BOUNDARIES = 25;
const MAX_GATES = 15;
const MAX_EXAMPLES = 3;

/** Packages worth a single owner module. Name or scope prefix. */
export const GATED_PACKAGES: readonly string[] = [
  // Payments
  "stripe",
  "@stripe/",
  "braintree",
  "@adyen/",
  "@paypal/",
  "paypalrestsdk",
  "adyen",
  // Databases and ORMs
  "@prisma/client",
  "prisma",
  "pg",
  "mysql2",
  "knex",
  "typeorm",
  "sequelize",
  "mongoose",
  "drizzle-orm",
  "sqlalchemy",
  "psycopg2",
  "psycopg",
  "pymongo",
  "asyncpg",
  "peewee",
  "redis",
  "ioredis",
  // HTTP clients
  "axios",
  "got",
  "node-fetch",
  "undici",
  "requests",
  "httpx",
  "aiohttp",
  // Cloud SDKs
  "@aws-sdk/",
  "aws-sdk",
  "boto3",
  "@google-cloud/",
  "google-cloud-",
  "@azure/",
  "azure-",
  // Email, queues, auth
  "nodemailer",
  "@sendgrid/",
  "resend",
  "postmark",
  "bullmq",
  "amqplib",
  "kafkajs",
  "celery",
  "jsonwebtoken",
  "jose",
  "passport",
  "bcrypt",
  "argon2",
];

export interface BoundaryProposal {
  /** The module that must not import, e.g. "src/domain". */
  from: string;
  /** The module it must not import, e.g. "src/infra". */
  forbid: string;
  /** Files in `from`. */
  files: number;
  /** Files in `forbid` that import `from`: the evidence of the direction. */
  importsBack: number;
  /** Files in `from` that import `forbid` today. */
  violations: number;
  examples: { file: string; line: number; target: string }[];
  fingerprint: string;
}

export interface GateProposal {
  package: string;
  /** The module that uses it, e.g. "src/payments". */
  only: string;
  /** Files in `only` that import it. */
  users: number;
  /** Files elsewhere that import it today. */
  violations: number;
  examples: { file: string; line: number }[];
  fingerprint: string;
}

const fingerprint = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\0")).digest("hex");

/** The module a file belongs to: its first directory under a source or workspace root. */
export function moduleOf(file: string): string | null {
  const parts = file.split("/");
  if (parts.length < 2) return null;
  const [a, b, c] = parts;
  if (WORKSPACE_ROOTS.includes(a as string)) {
    // A workspace package imported by name resolves to its directory, e.g. packages/core.
    if (parts.length === 2) return `${a}/${b}`;
    // packages/db/src/x → packages/db; apps/web/src/features/x → apps/web/src/features
    if (parts.length >= 5 && SOURCE_ROOTS.includes(c as string))
      return `${a}/${b}/${c}/${parts[3]}`;
    return `${a}/${b}`;
  }
  if (SOURCE_ROOTS.includes(a as string)) return parts.length >= 3 ? `${a}/${b}` : null;
  return a as string;
}

/** Whether `inner` is a directory under `outer`: a module and its parent are never a pair. */
const isWithin = (inner: string, outer: string) => inner.startsWith(`${outer}/`);

export function discoverArchitecture(
  files: readonly string[],
  edges: readonly ImportEdge[],
): { boundaries: BoundaryProposal[]; gates: GateProposal[] } {
  const code = files.filter((f) => isJsFile(f) || isPyFile(f));
  const moduleFiles = new Map<string, number>();
  for (const f of code) {
    const m = moduleOf(f);
    if (m) moduleFiles.set(m, (moduleFiles.get(m) ?? 0) + 1);
  }
  const modules = new Set(
    [...moduleFiles].filter(([, n]) => n >= MIN_MODULE_FILES).map(([m]) => m),
  );

  // Module → module: which files import across, with one example line each.
  const cross = new Map<string, Map<string, Map<string, { line: number; target: string }>>>();
  const packageUse = new Map<string, Map<string, Map<string, number>>>();
  for (const edge of edges) {
    const from = moduleOf(edge.file);
    if (!from || !modules.has(from)) continue;
    if (edge.resolved.kind === "path") {
      const to = moduleOf(edge.resolved.path);
      if (!to || to === from || !modules.has(to)) continue;
      const byTo = cross.get(from) ?? new Map();
      cross.set(from, byTo);
      const byFile = byTo.get(to) ?? new Map();
      byTo.set(to, byFile);
      if (!byFile.has(edge.file))
        byFile.set(edge.file, { line: edge.line, target: edge.resolved.path });
    } else {
      const name = edge.resolved.name;
      const gated = GATED_PACKAGES.some((p) =>
        p.endsWith("/") || p.endsWith("-") ? name.startsWith(p) : name === p,
      );
      if (!gated) continue;
      const byModule = packageUse.get(name) ?? new Map();
      packageUse.set(name, byModule);
      const byFile = byModule.get(from) ?? new Map();
      byModule.set(from, byFile);
      if (!byFile.has(edge.file)) byFile.set(edge.file, edge.line);
    }
  }
  const count = (a: string, b: string) => cross.get(a)?.get(b)?.size ?? 0;

  const boundaries: BoundaryProposal[] = [];
  for (const a of modules)
    for (const b of modules) {
      if (a === b || isWithin(a, b) || isWithin(b, a)) continue;
      const back = count(b, a); // b depends on a
      const forward = count(a, b); // a reaching into b: the violations
      if (back < MIN_DIRECTION) continue;
      if (forward > tolerated(back)) continue;
      const examples = [...(cross.get(a)?.get(b) ?? new Map())]
        .slice(0, MAX_EXAMPLES)
        .map(([file, e]) => ({ file, line: e.line, target: e.target }));
      boundaries.push({
        from: a,
        forbid: b,
        files: moduleFiles.get(a) ?? 0,
        importsBack: back,
        violations: forward,
        examples,
        fingerprint: fingerprint("boundary", a, b),
      });
    }
  // A rule between parents covers the same between their subdirectories: keep the parents'.
  const covers = (outer: string, inner: string) => outer === inner || isWithin(inner, outer);
  const kept = boundaries.filter(
    (b) => !boundaries.some((o) => o !== b && covers(o.from, b.from) && covers(o.forbid, b.forbid)),
  );
  boundaries.length = 0;
  boundaries.push(...kept);
  boundaries.sort(
    (x, y) =>
      y.importsBack - x.importsBack ||
      x.from.localeCompare(y.from) ||
      x.forbid.localeCompare(y.forbid),
  );

  const gates: GateProposal[] = [];
  for (const [pkg, byModule] of packageUse) {
    const ranked = [...byModule].sort((x, y) => y[1].size - x[1].size);
    const top = ranked[0];
    if (!top) continue;
    const users = top[1].size;
    const elsewhere = ranked.slice(1);
    const violations = elsewhere.reduce((n, [, f]) => n + f.size, 0);
    if (users < MIN_DIRECTION) continue;
    if (violations > tolerated(users)) continue;
    gates.push({
      package: pkg,
      only: top[0],
      users,
      violations,
      examples: elsewhere
        .flatMap(([, f]) => [...f])
        .slice(0, MAX_EXAMPLES)
        .map(([file, line]) => ({ file, line })),
      fingerprint: fingerprint("gate", pkg, top[0]),
    });
  }
  gates.sort((x, y) => y.users - x.users || x.package.localeCompare(y.package));

  return { boundaries: boundaries.slice(0, MAX_BOUNDARIES), gates: gates.slice(0, MAX_GATES) };
}

/** Glob for "everything under this module", as a rule's check would write it. */
export const moduleGlob = (module: string) => `${module}/**`;

/** The parent directory of a path, exported for tests. */
export { dirOf };
