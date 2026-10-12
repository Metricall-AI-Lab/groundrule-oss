#!/usr/bin/env node
// Publishes every @groundrule package whose current version isn't on npm yet, in dependency
// order. `pnpm pack` turns workspace:* dependencies into real versions; `npm publish` then
// uploads the tarball. Run it after `pnpm build`.
//
//   node scripts/publish.mjs            publish what's missing (asks npm to sign you in if needed)
//   node scripts/publish.mjs --dry-run  show what would be published, upload nothing
//
// In GitHub Actions it publishes through npm trusted publishing (OIDC) with provenance, so no
// npm token is stored anywhere. Locally, the first release needs `npm login` first.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORDER = ["spec", "mcp", "core", "evaluators", "adapters", "reporters", "packs", "cli"];
const dryRun = process.argv.includes("--dry-run");
const inCi = process.env.GITHUB_ACTIONS === "true";
const out = mkdtempSync(join(tmpdir(), "groundrule-publish-"));

const published = (name, version) => {
  try {
    return (
      execFileSync("npm", ["view", `${name}@${version}`, "version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === version
    );
  } catch {
    return false; // 404: not published yet
  }
};

let count = 0;
for (const dir of ORDER) {
  const pkgDir = join("packages", dir);
  const { name, version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  if (published(name, version)) {
    console.log(`  = ${name}@${version} is already on npm`);
    continue;
  }
  execFileSync("pnpm", ["pack", "--pack-destination", out], {
    cwd: pkgDir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = join(
    out,
    readdirSync(out).find((f) => f === `${name.slice(1).replace("/", "-")}-${version}.tgz`),
  );
  const args = [
    "publish",
    tarball,
    "--access",
    "public",
    ...(inCi ? ["--provenance"] : []),
    ...(dryRun ? ["--dry-run"] : []),
  ];
  console.log(`  ${dryRun ? "would publish" : "publishing"} ${name}@${version}`);
  const res = spawnSync("npm", args, { encoding: "utf8" });
  process.stdout.write(res.stdout ?? "");
  if (res.status !== 0) {
    // npm's registry can lag: a run right after another may not see a version that was just
    // published, and npm then refuses to publish it again. That version is on npm; move on.
    if (
      /cannot publish over the previously published versions|EPUBLISHCONFLICT/i.test(res.stderr)
    ) {
      console.log(`  = ${name}@${version} was already published (npm hadn't shown it yet)`);
      continue;
    }
    process.stderr.write(res.stderr ?? "");
    throw new Error(`npm publish failed for ${name}@${version}`);
  }
  process.stderr.write(res.stderr ?? "");
  count++;
}
console.log(
  count
    ? `✓ ${dryRun ? "Would publish" : "Published"} ${count} package(s).`
    : "✓ Nothing to publish: every version is already on npm.",
);
