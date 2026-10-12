import { readFile } from "node:fs/promises";
import { type CheckRunPullRequest, CheckRunPullRequest as Schema } from "@groundrule/spec";
import type { IO } from "./io.js";

const PR_EVENTS = new Set(["pull_request", "pull_request_target"]);

/**
 * The pull request a CI run is for, from the provider's own event data (GitHub Actions:
 * GITHUB_EVENT_NAME and the GITHUB_EVENT_PATH payload). Undefined outside a pull request,
 * or when the payload can't be read; a check never fails because of it.
 */
export async function pullRequestFromCi(io: IO): Promise<CheckRunPullRequest | undefined> {
  const event = io.env.GITHUB_EVENT_NAME;
  const path = io.env.GITHUB_EVENT_PATH;
  if (!event || !path || !PR_EVENTS.has(event)) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
  const pr = (payload as { pull_request?: Record<string, unknown> }).pull_request;
  if (!pr || typeof pr !== "object") return undefined;
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  const ref = (side: unknown) => text((side as { ref?: unknown } | undefined)?.ref, 255);
  const candidate = {
    number: pr.number,
    title: text(pr.title, 300),
    url: text(pr.html_url, 500),
    headRef: ref(pr.head),
    baseRef: ref(pr.base),
    author: text((pr.user as { login?: unknown } | undefined)?.login, 100),
  };
  const parsed = Schema.safeParse(
    Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined)),
  );
  if (parsed.success) return parsed.data;
  // A bad optional field shouldn't lose the pull request number.
  const fallback = Schema.safeParse({ number: pr.number });
  return fallback.success ? fallback.data : undefined;
}
