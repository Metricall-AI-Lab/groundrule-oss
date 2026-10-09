import { CONFIG_DIR, CONFIG_FILE, findConfig, loadFile } from "@groundrule/core";
import type { Config } from "@groundrule/spec";
import { EXIT, eprintln, type IO, println, style } from "../io.js";
import {
  call,
  clientName,
  credentialsPath,
  openUrl,
  PlatformError,
  platformUrl,
  readCredentials,
  removeCredential,
  saveCredential,
  sleep,
  tokenFor,
} from "../platform.js";

interface StartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface Identity {
  org: { slug: string; name: string };
  user: { email: string; name: string | null };
}

/** The config for the current repository, if there is one (for its platform settings). */
async function repoConfig(io: IO): Promise<Config | undefined> {
  const file = await findConfig(io.cwd);
  if (!file) return undefined;
  const result = await loadFile(file, "Config");
  return result.ok ? result.document : undefined;
}

const fail = (io: IO, message: string) => {
  eprintln(io, `${style(io, "stderr").red("✕")} ${message}`);
  return EXIT.usage;
};

/** `groundrule login`: sign this computer in through the browser (device flow). */
export async function login(io: IO, options: { url?: string; browser?: boolean }): Promise<number> {
  const s = style(io);
  try {
    const config = await repoConfig(io);
    const url = platformUrl(io, options.url, config);
    const start = await call<StartResponse>(io, url, "/v1/cli/login", {
      method: "POST",
      body: { clientName: clientName(io) },
    });

    println(io);
    println(io, ` ${s.bold("groundrule login")} ${s.dim(`· ${url}`)}`);
    println(io);
    println(io, `   Your one-time code:  ${s.bold(start.userCode)}`);
    println(io, `   Approve it at:       ${start.verificationUriComplete}`);
    const interactive = Boolean(io.stdout.isTTY) && !io.env.CI;
    if (
      options.browser !== false &&
      interactive &&
      (await openUrl(io, start.verificationUriComplete))
    )
      println(io, `   ${s.dim("Opened your browser. Check the code matches, then approve.")}`);
    println(io);
    println(io, `   ${s.dim("Waiting for approval…")}`);

    const deadline = Date.now() + start.expiresIn * 1000;
    let interval = Math.max(start.interval, 1);
    for (;;) {
      await sleep(io, interval * 1000);
      if (Date.now() > deadline) return fail(io, "The code expired. Run `groundrule login` again.");
      try {
        const done = await call<Identity & { token: string }>(io, url, "/v1/cli/login/token", {
          method: "POST",
          body: { deviceCode: start.deviceCode },
        });
        // Replace (and revoke) an older login for the same organization.
        const previous = await tokenFor(io, url, done.org.slug);
        if (previous?.source === "login" && previous.token !== done.token) {
          await call(io, url, "/v1/cli/token", { method: "DELETE", token: previous.token }).catch(
            () => {},
          );
        }
        await saveCredential(io, url, {
          token: done.token,
          org: done.org.slug,
          orgName: done.org.name,
          user: done.user.email,
          savedAt: new Date().toISOString(),
        });
        println(io);
        println(
          io,
          ` ${s.green("✓")} Signed in to ${s.bold(done.org.name)} ${s.dim(`(${done.org.slug})`)} as ${done.user.email}`,
        );
        println(io, `   ${s.dim(`Saved to ${credentialsPath(io)} (only you can read it).`)}`);
        println(io);
        if (config?.platform?.org === done.org.slug) {
          println(io, ` ${s.bold("Next")}  ${s.bold("groundrule sync")}`);
        } else if (config?.platform) {
          println(
            io,
            ` ${s.yellow("!")} This repository uses ${config.platform.org}. Run login again and approve it for ${config.platform.org}.`,
          );
        } else {
          println(io, ` ${s.bold("Next")}`);
          println(
            io,
            `   1. ${s.bold(`groundrule init --org ${done.org.slug}`)}   connect this repository (or add platform: { org: ${done.org.slug} } to ${CONFIG_DIR}/${CONFIG_FILE})`,
          );
          println(
            io,
            `   2. ${s.bold("groundrule sync")}    write your organization's rules for your coding agents`,
          );
        }
        println(io);
        return EXIT.ok;
      } catch (error) {
        if (!(error instanceof PlatformError)) throw error;
        if (error.code === "authorization_pending") continue;
        if (error.code === "slow_down") {
          interval += 5;
          continue;
        }
        if (error.code === "access_denied")
          return fail(io, "The sign-in was declined in the browser. Nothing was saved.");
        if (error.code === "expired_token" || error.code === "invalid_grant")
          return fail(io, "The code expired. Run `groundrule login` again.");
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof PlatformError) return fail(io, error.message);
    throw error;
  }
}

/** `groundrule logout`: revoke the saved token(s) for this platform and forget them. */
export async function logout(io: IO, options: { url?: string; org?: string }): Promise<number> {
  const s = style(io);
  try {
    const url = platformUrl(io, options.url, await repoConfig(io));
    const removed = await removeCredential(io, url, options.org);
    if (removed.length === 0) {
      println(io, `Not signed in to ${options.org ?? "any organization"} on ${url}.`);
      return EXIT.ok;
    }
    for (const credential of removed) {
      // Revoke on the server too, so a copied token stops working.
      const revoked = await call(io, url, "/v1/cli/token", {
        method: "DELETE",
        token: credential.token,
      })
        .then(() => true)
        .catch(() => false);
      println(
        io,
        ` ${s.green("✓")} Signed out of ${credential.orgName} ${s.dim(`(${credential.org})`)}${revoked ? "" : s.dim(" · couldn't reach the server to revoke the token; revoke it in Settings → API tokens")}`,
      );
    }
    return EXIT.ok;
  } catch (error) {
    if (error instanceof PlatformError) return fail(io, error.message);
    throw error;
  }
}

/** `groundrule whoami`: which organization and person each saved login acts as. */
export async function whoami(io: IO, options: { url?: string; json?: boolean }): Promise<number> {
  const s = style(io);
  try {
    const config = await repoConfig(io);
    const url = platformUrl(io, options.url, config);
    // With no platform named anywhere (flag, GROUNDRULE_URL, or this repository), show
    // every saved login, so one made with `login --url` is found from any folder.
    const anywhere =
      !options.url && !io.env.GROUNDRULE_URL && !config?.platform?.url && !io.env.GROUNDRULE_TOKEN;
    const hosts = (await readCredentials(io)).hosts;
    const tokens = io.env.GROUNDRULE_TOKEN
      ? [{ url, token: io.env.GROUNDRULE_TOKEN.trim(), label: "GROUNDRULE_TOKEN" }]
      : Object.entries(hosts)
          .filter(([host]) => anywhere || host === url)
          .flatMap(([host, { orgs }]) =>
            Object.values(orgs).map((c) => ({ url: host, token: c.token, label: "saved login" })),
          );
    if (tokens.length === 0) {
      eprintln(
        io,
        `${anywhere ? "Not signed in" : `Not signed in to ${url}`}. Run \`groundrule login\`.`,
      );
      return EXIT.failed;
    }
    const rows = [];
    for (const t of tokens) {
      try {
        const who = await call<
          Identity & { token: { name: string; prefix: string; expiresAt: string | null } }
        >(io, t.url, "/v1/cli/whoami", { token: t.token });
        rows.push({ ok: true as const, url: t.url, source: t.label, ...who });
      } catch (error) {
        if (!(error instanceof PlatformError) || error.status !== 401) throw error;
        rows.push({
          ok: false as const,
          url: t.url,
          source: t.label,
          prefix: t.token.slice(0, 12),
        });
      }
    }
    if (options.json) {
      io.stdout.write(`${JSON.stringify({ url, logins: rows }, null, 2)}\n`);
      return rows.every((r) => r.ok) ? EXIT.ok : EXIT.failed;
    }
    println(io);
    for (const r of rows) {
      if (r.ok) {
        const expires = r.token.expiresAt
          ? `expires ${r.token.expiresAt.slice(0, 10)}`
          : "never expires";
        println(
          io,
          ` ${s.green("✓")} ${s.bold(r.org.name)} ${s.dim(`(${r.org.slug})`)} as ${r.user.email}`,
        );
        println(
          io,
          `   ${s.dim(`${r.token.prefix}… · ${r.token.name} · ${expires} · ${r.source} · ${r.url}`)}`,
        );
      } else {
        println(
          io,
          ` ${s.red("✕")} ${r.prefix}… is no longer valid ${s.dim(`(${r.source})`)}. Run \`groundrule login\`.`,
        );
      }
    }
    if (config?.platform) {
      const active = rows.some((r) => r.ok && r.org.slug === config.platform?.org);
      println(io);
      println(
        io,
        active
          ? `   ${s.dim(`This repository uses ${config.platform.org}.`)}`
          : ` ${s.yellow("!")} This repository uses ${config.platform.org}, which you're not signed in to.`,
      );
    }
    println(io);
    return rows.every((r) => r.ok) ? EXIT.ok : EXIT.failed;
  } catch (error) {
    if (error instanceof PlatformError) return fail(io, error.message);
    throw error;
  }
}
