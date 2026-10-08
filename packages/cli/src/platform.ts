// Talking to the Groundrule platform: where it is, the credentials for it, and the
// rulebook it serves. The open-source CLI works fully offline; this is used only when a
// repository's config has `platform:` or you run `groundrule login`.
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Diagnostic, LoadedStandard } from "@groundrule/core";
import { type Config, compareRolloutStage, type RolloutStage, Standard } from "@groundrule/spec";
import type { IO } from "./io.js";
import { VERSION } from "./io.js";

export const DEFAULT_PLATFORM_URL = "https://app.groundrule.dev";

/** A problem talking to the platform, with a message meant for people. */
export class PlatformError extends Error {
  override name = "PlatformError";
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- where

/** The platform origin, e.g. https://app.groundrule.dev. Plain http only for localhost. */
export function platformUrl(io: IO, explicit?: string, config?: Config): string {
  const raw = explicit ?? io.env.GROUNDRULE_URL ?? config?.platform?.url ?? DEFAULT_PLATFORM_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PlatformError(`"${raw}" isn't a valid URL.`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new PlatformError(
      `Refusing to send credentials to ${url.origin}: use https (plain http is only allowed for localhost).`,
    );
  }
  return url.origin;
}

// ---------------------------------------------------------------- credentials

export interface Credential {
  token: string;
  org: string;
  orgName: string;
  user: string;
  savedAt: string;
}

interface CredentialFile {
  version: 1;
  hosts: Record<string, { orgs: Record<string, Credential> }>;
}

export function configDir(io: IO): string {
  if (io.configDir) return io.configDir;
  if (io.env.XDG_CONFIG_HOME) return join(io.env.XDG_CONFIG_HOME, "groundrule");
  if (process.platform === "win32" && io.env.APPDATA) return join(io.env.APPDATA, "groundrule");
  return join(homedir(), ".config", "groundrule");
}

export const credentialsPath = (io: IO) => join(configDir(io), "credentials.json");

export async function readCredentials(io: IO): Promise<CredentialFile> {
  try {
    const parsed = JSON.parse(await readFile(credentialsPath(io), "utf8")) as CredentialFile;
    if (parsed?.version === 1 && parsed.hosts && typeof parsed.hosts === "object") return parsed;
  } catch {
    // Missing or unreadable: start fresh.
  }
  return { version: 1, hosts: {} };
}

/** Written atomically and readable only by you (0600, in a 0700 directory). */
export async function writeCredentials(io: IO, file: CredentialFile): Promise<void> {
  const path = credentialsPath(io);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600).catch(() => {});
  await rename(temp, path);
}

export async function saveCredential(io: IO, url: string, credential: Credential) {
  const file = await readCredentials(io);
  const host = file.hosts[url] ?? { orgs: {} };
  host.orgs[credential.org] = credential;
  file.hosts[url] = host;
  await writeCredentials(io, file);
}

export async function removeCredential(io: IO, url: string, org?: string): Promise<Credential[]> {
  const file = await readCredentials(io);
  const host = file.hosts[url];
  if (!host) return [];
  const removed = org
    ? [host.orgs[org]].filter((c): c is Credential => Boolean(c))
    : Object.values(host.orgs);
  if (org) delete host.orgs[org];
  else delete file.hosts[url];
  if (host && Object.keys(host.orgs).length === 0) delete file.hosts[url];
  if (Object.keys(file.hosts).length === 0) await rm(credentialsPath(io), { force: true });
  else await writeCredentials(io, file);
  return removed;
}

/**
 * The token to use: GROUNDRULE_TOKEN (CI) wins; otherwise the saved login for this
 * organization, or the only one saved for this platform.
 */
export async function tokenFor(
  io: IO,
  url: string,
  org?: string,
): Promise<{ token: string; source: "env" | "login"; credential?: Credential } | undefined> {
  if (io.env.GROUNDRULE_TOKEN) return { token: io.env.GROUNDRULE_TOKEN.trim(), source: "env" };
  const orgs = (await readCredentials(io)).hosts[url]?.orgs ?? {};
  const credential = org
    ? orgs[org]
    : Object.values(orgs).length === 1
      ? Object.values(orgs)[0]
      : undefined;
  return credential ? { token: credential.token, source: "login", credential } : undefined;
}

// ---------------------------------------------------------------- http

export async function call<T>(
  io: IO,
  url: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const doFetch = io.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${url}/api${path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        "user-agent": `groundrule-cli/${VERSION}`,
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new PlatformError(
      `Couldn't reach Groundrule at ${url} (${(error as Error).message}). Check your connection or GROUNDRULE_URL.`,
    );
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new PlatformError(
      `Groundrule at ${url} sent an unexpected response (HTTP ${res.status}).`,
    );
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new PlatformError(
      err?.message ?? `Groundrule responded with HTTP ${res.status}.`,
      err?.code,
      res.status,
    );
  }
  return body as T;
}

// ---------------------------------------------------------------- repository

const execFileAsync = promisify(execFile);

/** owner/name from the origin remote, e.g. git@github.com:acme/api.git → acme/api. */
export function repositoryFromRemote(remote: string): string | undefined {
  const trimmed = remote
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const scp = /^[^@/]+@[^:/]+:(.+)$/.exec(trimmed);
  let path: string | undefined = scp?.[1];
  if (!path) {
    try {
      path = new URL(trimmed).pathname.replace(/^\/+/, "");
    } catch {
      return undefined;
    }
  }
  return path?.includes("/") ? decodeURIComponent(path) : undefined;
}

export async function detectRepository(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: root });
    return repositoryFromRemote(stdout);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- rulebook

export interface PlatformRulebook {
  org: { slug: string; name: string; codingAgents: string[] };
  target: {
    level: "organization" | "team" | "repository";
    team: { slug: string; name: string } | null;
    repository: { name: string } | null;
  };
  repositoryKnown: boolean;
  generatedAt: string;
  standards: { stage: RolloutStage; origin: string; document: unknown }[];
}

/** Which rules a command uses: agent files get Teach and above; checks run Advise and above. */
export type Use = "agents" | "checks" | "all";

export interface PlatformStandards {
  url: string;
  rulebook: PlatformRulebook;
  standards: LoadedStandard[];
  diagnostics: Diagnostic[];
}

/**
 * Load the organization's rulebook for this repository and turn it into standards the
 * kernel understands. Every document is validated against the spec before use.
 */
export async function loadPlatformStandards(
  io: IO,
  config: Config,
  root: string,
  configFile: string,
  use: Use,
): Promise<PlatformStandards> {
  const platform = config.platform;
  if (!platform) throw new PlatformError("This repository isn't connected to the platform.");
  const url = platformUrl(io, undefined, config);
  const auth = await tokenFor(io, url, platform.org);
  if (!auth) {
    throw new PlatformError(
      `Not signed in to ${platform.org} on ${url}. Run \`groundrule login\` (or set GROUNDRULE_TOKEN in CI).`,
    );
  }
  const repository = platform.repository ?? (await detectRepository(root));
  const query = repository ? `?repository=${encodeURIComponent(repository)}` : "";
  let rulebook: PlatformRulebook;
  try {
    rulebook = await call<PlatformRulebook>(io, url, `/v1/cli/rulebook${query}`, {
      token: auth.token,
    });
  } catch (error) {
    if (error instanceof PlatformError && error.status === 401) {
      throw new PlatformError(
        auth.source === "env"
          ? "GROUNDRULE_TOKEN isn't valid. It may have expired or been revoked; create a new one in Groundrule → Settings → API tokens."
          : `Your sign-in to ${platform.org} has expired or was revoked. Run \`groundrule login\` again.`,
        error.code,
        401,
      );
    }
    throw error;
  }
  if (rulebook.org.slug !== platform.org) {
    throw new PlatformError(
      `This token is for ${rulebook.org.slug}, but this repository uses ${platform.org}. Run \`groundrule login\` and approve it for ${platform.org}.`,
    );
  }

  const diagnostics: Diagnostic[] = [];
  const standards: LoadedStandard[] = [];
  for (const entry of rulebook.standards) {
    const parsed = Standard.safeParse(entry.document);
    const id = (entry.document as { metadata?: { id?: string } })?.metadata?.id ?? "unknown";
    if (!parsed.success) {
      diagnostics.push({
        severity: "warning",
        file: configFile,
        message: `Skipped ${id} from the platform: it doesn't match this CLI's spec (upgrade @groundrule/cli).`,
      });
      continue;
    }
    if (use === "checks" && compareRolloutStage(entry.stage, "advise") < 0) continue;
    let standard = parsed.data;
    // Advise reports findings without failing the build.
    if (use === "checks" && entry.stage === "advise" && standard.spec.severity === "blocker") {
      standard = { ...standard, spec: { ...standard.spec, severity: "warning" } };
    }
    standards.push({
      standard,
      file: `${url}/${platform.org}/standards/${standard.metadata.id}`,
      origin: `platform:${entry.origin === "organization" ? platform.org : entry.origin}`,
      disabled: false,
      stage: entry.stage,
      ...(standard.spec.severity !== parsed.data.spec.severity
        ? { originalSeverity: parsed.data.spec.severity }
        : {}),
    });
  }
  if (repository && !rulebook.repositoryKnown) {
    diagnostics.push({
      severity: "warning",
      file: configFile,
      message: `${repository} isn't registered in ${platform.org}, so the organization's rules apply. Add it under Teams → Repositories to use its team's settings.`,
    });
  }
  return { url, rulebook, standards, diagnostics };
}

// ---------------------------------------------------------------- local machine

export const clientName = (io: IO) =>
  `groundrule on ${(io.hostname ?? hostname()).replace(/[^\w.-]/g, "").slice(0, 80) || "this computer"}`;

/** Open a URL in the default browser, without a shell. */
export function openUrl(io: IO, url: string): Promise<boolean> {
  if (io.openUrl) return io.openUrl(url);
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export const sleep = (io: IO, ms: number) =>
  io.sleep ? io.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms));
