// Action policies (RFC 0017): deciding whether an agent may run the operation it intends.
// Pure string matching, compiled once per policy; no file is read and nothing is executed.
import {
  type ActionEffect,
  type ActionKind,
  type ActionPolicy,
  compareActionEffect,
  type ExceptionEntry,
  isExceptionActive,
  type RolloutStage,
} from "@groundrule/spec";
import picomatch from "picomatch";
import { matchesScope, type ScopeTarget } from "./scope.js";

export interface LoadedActionPolicy {
  policy: ActionPolicy;
  /** Absolute path of the file that defines it, or its platform address. */
  file: string;
  /** "local", or the extends reference, e.g. groundrule:packs/agent-actions. */
  origin: string;
  /** For policies from the platform: the rollout stage the organization chose. */
  stage?: RolloutStage;
}

/** The operation an agent intends, as its hook reports it. Unknown facts never match a pattern. */
export interface AgentAction {
  kind: ActionKind;
  /** The tool name as the agent reports it, e.g. Bash, Edit, mcp__github__create_issue. */
  tool?: string;
  /** shell: the command. */
  command?: string;
  /** edit, read: the repository-relative POSIX path, or the absolute path outside the repository. */
  path?: string;
  /** fetch: the host of the URL. */
  host?: string;
  /** mcp: the server name and the tool's own name. */
  server?: string;
  mcpTool?: string;
}

export interface MatchedPolicy {
  id: string;
  title: string;
  effect: ActionEffect;
  severity: ActionPolicy["spec"]["severity"];
  requirement: string;
  summary?: string;
  stage?: RolloutStage;
  /** The exception that lifted this policy, when one did. */
  exception?: string;
}

export interface ActionDecision {
  /** What the agent is told; undefined when no policy decides (nothing matched, or advisory only). */
  effect?: ActionEffect;
  /** Policies that matched and were counted, strictest first. */
  policies: MatchedPolicy[];
  /** Policies that matched but only advise (stage advise, or lifted by an exception). */
  advisory: MatchedPolicy[];
}

const GLOB_OPTIONS = { dot: true } as const;

/** `*` matches anything, `?` one character; everything else is literal. Anchored. */
function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("")
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\/]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`, "s");
}

const regexps = new Map<string, RegExp>();
function matchesPattern(value: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => {
    let re = regexps.get(p);
    if (!re) {
      re = patternToRegExp(p);
      regexps.set(p, re);
    }
    return re.test(value);
  });
}

function partition<T>(items: readonly T[], test: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (test(item) ? yes : no).push(item);
  return [yes, no];
}

/** The parts of a compound shell command, each trimmed: `a && b | c` gives a, b and c. */
export function commandSegments(command: string): string[] {
  return command
    .split(/\|\||&&|;|\||\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True if the policy's `when` matches the action. */
export function matchesAction(policy: ActionPolicy, action: AgentAction): boolean {
  const w = policy.spec.when;
  if (w.actions && !w.actions.includes(action.kind)) return false;
  if (w.commands) {
    if (action.command === undefined) return false;
    // A pattern that names a pipe or a chain is matched against the whole command line;
    // any other pattern against each segment, so `git status && git push -f` is caught.
    const [whole, perSegment] = partition(w.commands, (p) => /\|\||&&|;|\|/.test(p));
    const segments = commandSegments(action.command);
    const hit =
      (whole.length > 0 && matchesPattern(action.command.trim(), whole)) ||
      (perSegment.length > 0 && segments.some((seg) => matchesPattern(seg, perSegment)));
    if (!hit) return false;
  }
  if (w.paths) {
    if (action.path === undefined) return false;
    if (!picomatch.isMatch(action.path, w.paths, GLOB_OPTIONS)) return false;
  }
  if (w.hosts) {
    if (action.host === undefined) return false;
    if (!matchesPattern(action.host, w.hosts)) return false;
  }
  if (w.servers) {
    if (action.server === undefined) return false;
    if (!matchesPattern(action.server, w.servers)) return false;
  }
  if (w.tools) {
    const names = [action.tool, action.mcpTool].filter((n): n is string => n !== undefined);
    if (!names.some((n) => matchesPattern(n, w.tools ?? []))) return false;
  }
  return true;
}

/**
 * Decide an intended action against the policies in effect. Precedence is deny > ask > allow.
 * An active exception for a policy (paths applying to file actions) lifts it and is named;
 * a platform policy at observe or teach takes no part, and one at advise only advises.
 */
export function decideAction(
  policies: readonly LoadedActionPolicy[],
  exceptions: readonly ExceptionEntry[],
  action: AgentAction,
  target: Omit<ScopeTarget, "path"> = {},
  now = new Date(),
): ActionDecision {
  const counted: MatchedPolicy[] = [];
  const advisory: MatchedPolicy[] = [];
  for (const l of policies) {
    const { policy } = l;
    if (policy.metadata.status !== "active") continue;
    if (l.stage === "observe" || l.stage === "teach") continue;
    const scope = policy.spec.scope;
    const scoped =
      action.kind === "edit" || action.kind === "read"
        ? { ...target, ...(action.path !== undefined ? { path: action.path } : {}) }
        : target;
    if (!matchesScope(scope, scoped)) continue;
    if (!matchesAction(policy, action)) continue;
    const matched: MatchedPolicy = {
      id: policy.metadata.id,
      title: policy.metadata.title,
      effect: policy.spec.effect,
      severity: policy.spec.severity,
      requirement: policy.spec.requirement,
      ...(policy.spec.agent.summary ? { summary: policy.spec.agent.summary } : {}),
      ...(l.stage ? { stage: l.stage } : {}),
    };
    const exception = exceptions.find(
      (e) =>
        e.standard === policy.metadata.id &&
        isExceptionActive(e, now) &&
        (action.path === undefined || picomatch.isMatch(action.path, e.paths, GLOB_OPTIONS)),
    );
    if (exception) {
      advisory.push({ ...matched, exception: exception.id });
      continue;
    }
    if (l.stage === "advise") {
      advisory.push(matched);
      continue;
    }
    counted.push(matched);
  }
  counted.sort((a, b) => compareActionEffect(b.effect, a.effect) || a.id.localeCompare(b.id));
  const effect = counted[0]?.effect;
  return { ...(effect ? { effect } : {}), policies: counted, advisory };
}

/** Action policies that are in effect: active and, from the platform, not at observe. */
export function effectiveActionPolicies(
  policies: readonly LoadedActionPolicy[],
): LoadedActionPolicy[] {
  return policies.filter((p) => p.policy.metadata.status === "active" && p.stage !== "observe");
}
