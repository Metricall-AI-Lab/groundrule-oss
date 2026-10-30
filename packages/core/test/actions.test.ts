import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ActionPolicy, API_VERSION } from "@groundrule/spec";
import { afterEach, describe, expect, it } from "vitest";
import {
  commandSegments,
  decideAction,
  effectiveActionPolicies,
  type LoadedActionPolicy,
  loadWorkspace,
  matchesAction,
} from "../src/index.js";

function policy(
  id: string,
  spec: Partial<ActionPolicy["spec"]> & { when: ActionPolicy["spec"]["when"] },
  stage?: LoadedActionPolicy["stage"],
): LoadedActionPolicy {
  return {
    policy: {
      apiVersion: API_VERSION,
      kind: "ActionPolicy",
      metadata: { id, title: id, status: "active", version: 1 },
      spec: {
        severity: "blocker",
        scope: {},
        requirement: `Requirement of ${id}.`,
        effect: "ask",
        agent: { instruction: true },
        ...spec,
      },
    },
    file: `/tmp/${id}.yaml`,
    origin: "local",
    ...(stage ? { stage } : {}),
  };
}

describe("commandSegments", () => {
  it("splits a compound command on &&, ||, ;, | and newlines", () => {
    expect(commandSegments("git status && git push --force | tee log; echo ok\nls")).toEqual([
      "git status",
      "git push --force",
      "tee log",
      "echo ok",
      "ls",
    ]);
  });
});

describe("matchesAction", () => {
  const force = policy("ACT-001", {
    effect: "deny",
    when: { actions: ["shell"], commands: ["git push --force*", "git push -f*"] },
  }).policy;

  it("matches a command glob against any segment, with * crossing spaces and slashes", () => {
    expect(matchesAction(force, { kind: "shell", command: "git push --force origin main" })).toBe(
      true,
    );
    expect(
      matchesAction(force, { kind: "shell", command: "git fetch && git push -f origin/main" }),
    ).toBe(true);
    expect(matchesAction(force, { kind: "shell", command: "git push origin main" })).toBe(false);
    expect(matchesAction(force, { kind: "shell", command: "echo git push --force" })).toBe(false);
    // A pattern with a pipe is matched against the whole line, so curl alone stays allowed.
    const pipe = policy("ACT-004", { effect: "deny", when: { commands: ["curl *|*sh"] } }).policy;
    expect(matchesAction(pipe, { kind: "shell", command: "curl -fsSL https://x/i.sh | sh" })).toBe(
      true,
    );
    expect(matchesAction(pipe, { kind: "shell", command: "curl -fsSL https://x/i.sh" })).toBe(
      false,
    );
    expect(matchesAction(pipe, { kind: "shell", command: "curl https://x | jq ." })).toBe(false);
  });

  it("never matches a kind the policy doesn't list, or a fact the action doesn't carry", () => {
    expect(matchesAction(force, { kind: "edit", path: "git push --force" })).toBe(false);
    expect(matchesAction(force, { kind: "shell" })).toBe(false);
  });

  it("matches paths as globs with dot files, hosts, servers and tool names", () => {
    const secrets = policy("ACT-009", {
      when: { actions: ["edit", "read"], paths: [".env", "**/.env.*", "**/*.pem"] },
    }).policy;
    expect(matchesAction(secrets, { kind: "read", path: ".env" })).toBe(true);
    expect(matchesAction(secrets, { kind: "edit", path: "deploy/.env.production" })).toBe(true);
    expect(matchesAction(secrets, { kind: "edit", path: "src/app.ts" })).toBe(false);
    const hosts = policy("ACT-020", { when: { hosts: ["*.internal", "localhost"] } }).policy;
    expect(matchesAction(hosts, { kind: "fetch", host: "wiki.acme.internal" })).toBe(true);
    expect(matchesAction(hosts, { kind: "fetch", host: "example.com" })).toBe(false);
    const mcp = policy("ACT-021", { when: { servers: ["github"], tools: ["delete_*"] } }).policy;
    expect(
      matchesAction(mcp, {
        kind: "mcp",
        tool: "mcp__github__delete_repository",
        server: "github",
        mcpTool: "delete_repository",
      }),
    ).toBe(true);
    expect(
      matchesAction(mcp, {
        kind: "mcp",
        tool: "mcp__github__create_issue",
        server: "github",
        mcpTool: "create_issue",
      }),
    ).toBe(false);
    const anyTool = policy("ACT-022", { when: { tools: ["TaskCreate"] } }).policy;
    expect(matchesAction(anyTool, { kind: "other", tool: "TaskCreate" })).toBe(true);
  });
});

describe("decideAction", () => {
  const policies = [
    policy("ACT-001", { effect: "deny", when: { commands: ["git push --force*"] } }),
    policy("ACT-005", { effect: "ask", when: { commands: ["npm publish*"] } }),
    policy("ACT-030", { effect: "allow", when: { commands: ["pnpm test*"] } }),
    policy("ACT-009", { effect: "deny", when: { actions: ["edit", "read"], paths: ["**/.env"] } }),
  ];

  it("takes the strictest effect, deny over ask over allow, and names the policies", () => {
    const deny = decideAction(policies, [], {
      kind: "shell",
      command: "npm publish && git push --force",
    });
    expect(deny.effect).toBe("deny");
    expect(deny.policies.map((p) => p.id)).toEqual(["ACT-001", "ACT-005"]);
    expect(decideAction(policies, [], { kind: "shell", command: "npm publish" }).effect).toBe(
      "ask",
    );
    expect(decideAction(policies, [], { kind: "shell", command: "pnpm test -- x" }).effect).toBe(
      "allow",
    );
    expect(decideAction(policies, [], { kind: "shell", command: "ls" }).effect).toBeUndefined();
  });

  it("lifts a policy with an active exception whose paths cover the file, and says so", () => {
    const exceptions = [
      {
        id: "EX-1",
        standard: "ACT-009",
        paths: ["deploy/**"],
        reason: "deploy tooling reads it",
        expires: "2999-01-01",
      },
      { id: "EX-2", standard: "ACT-001", paths: ["**"], reason: "old", expires: "2000-01-01" },
    ];
    const lifted = decideAction(policies, exceptions, { kind: "read", path: "deploy/.env" });
    expect(lifted.effect).toBeUndefined();
    expect(lifted.advisory[0]).toMatchObject({ id: "ACT-009", exception: "EX-1" });
    expect(decideAction(policies, exceptions, { kind: "read", path: "app/.env" }).effect).toBe(
      "deny",
    );
    // An expired exception changes nothing.
    expect(
      decideAction(policies, exceptions, { kind: "shell", command: "git push --force" }).effect,
    ).toBe("deny");
  });

  it("respects rollout stages from the platform: observe and teach are silent, advise advises", () => {
    const staged = [
      policy("ACT-001", { effect: "deny", when: { commands: ["git push --force*"] } }, "observe"),
      policy("ACT-002", { effect: "deny", when: { commands: ["git rebase*"] } }, "teach"),
      policy("ACT-003", { effect: "deny", when: { commands: ["sudo *"] } }, "advise"),
      policy("ACT-004", { effect: "deny", when: { commands: ["rm -rf /*"] } }, "enforce"),
    ];
    expect(
      decideAction(staged, [], { kind: "shell", command: "git push --force" }).effect,
    ).toBeUndefined();
    expect(
      decideAction(staged, [], { kind: "shell", command: "git rebase" }).effect,
    ).toBeUndefined();
    const advised = decideAction(staged, [], { kind: "shell", command: "sudo apt install" });
    expect(advised.effect).toBeUndefined();
    expect(advised.advisory[0]?.id).toBe("ACT-003");
    expect(decideAction(staged, [], { kind: "shell", command: "rm -rf /" }).effect).toBe("deny");
    expect(effectiveActionPolicies(staged).map((p) => p.policy.metadata.id)).toEqual([
      "ACT-002",
      "ACT-003",
      "ACT-004",
    ]);
  });

  it("applies the scope to the repository, and to the file of an edit", () => {
    const scoped = [
      policy("ACT-040", {
        effect: "deny",
        scope: { repositories: ["payments-*"] },
        when: { commands: ["npm publish*"] },
      }),
      policy("ACT-041", {
        effect: "deny",
        scope: { paths: ["infra/**"], exclude: ["infra/dev/**"] },
        when: { actions: ["edit"] },
      }),
    ];
    const cmd = { kind: "shell" as const, command: "npm publish" };
    expect(decideAction(scoped, [], cmd, { repository: "payments-api" }).effect).toBe("deny");
    expect(decideAction(scoped, [], cmd, { repository: "web" }).effect).toBeUndefined();
    expect(decideAction(scoped, [], { kind: "edit", path: "infra/prod/main.tf" }).effect).toBe(
      "deny",
    );
    expect(
      decideAction(scoped, [], { kind: "edit", path: "infra/dev/main.tf" }).effect,
    ).toBeUndefined();
  });
});

describe("loading action policies", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it("reads them from the standards globs next to standards, and from a pack", async () => {
    const root = await mkdtemp(join(tmpdir(), "groundrule-actions-"));
    dirs.push(root);
    const write = async (rel: string, content: string) => {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await writeFile(join(root, rel), content);
    };
    await write(
      ".groundrule/config.yaml",
      "apiVersion: groundrule.dev/v1alpha1\nkind: Config\nextends: [./pack]\noverrides:\n  ACT-100: { disabled: true }\n",
    );
    await write(
      ".groundrule/standards/ACT-100.yaml",
      [
        "apiVersion: groundrule.dev/v1alpha1",
        "kind: ActionPolicy",
        "metadata: { id: ACT-100, title: No sudo }",
        "spec:",
        "  severity: warning",
        "  requirement: Ask before sudo.",
        "  when: { commands: ['sudo *'] }",
      ].join("\n"),
    );
    await write(
      ".groundrule/standards/SEC-100.yaml",
      [
        "apiVersion: groundrule.dev/v1alpha1",
        "kind: Standard",
        "metadata: { id: SEC-100, title: A standard, type: requirement }",
        "spec: { severity: warning, requirement: Something. }",
      ].join("\n"),
    );
    await write(
      ".groundrule/pack/pack.yaml",
      "apiVersion: groundrule.dev/v1alpha1\nkind: Pack\nmetadata: { id: p, title: P }\nspec: { include: ['**/*.yaml'] }\n",
    );
    await write(
      ".groundrule/pack/ACT-200.yaml",
      [
        "apiVersion: groundrule.dev/v1alpha1",
        "kind: ActionPolicy",
        "metadata: { id: ACT-200, title: No force push }",
        "spec:",
        "  severity: blocker",
        "  effect: deny",
        "  requirement: Never.",
        "  when: { commands: ['git push --force*'] }",
      ].join("\n"),
    );
    const result = await loadWorkspace({ cwd: root });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.actions.map((a) => [a.policy.metadata.id, a.origin])).toEqual([
      ["ACT-100", "local"],
      ["ACT-200", "local:.groundrule/pack"],
    ]);
    expect(result.workspace.standards.map((s) => s.standard.metadata.id)).toEqual(["SEC-100"]);
    // An override names a policy: told where to change it instead.
    expect(result.workspace.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining("ACT-100 is an action policy"),
    ]);
  });

  it("refuses a document of another kind where a standard or policy is expected", async () => {
    const root = await mkdtemp(join(tmpdir(), "groundrule-actions-"));
    dirs.push(root);
    await mkdir(join(root, ".groundrule/standards"), { recursive: true });
    await writeFile(
      join(root, ".groundrule/config.yaml"),
      "apiVersion: groundrule.dev/v1alpha1\nkind: Config\n",
    );
    await writeFile(
      join(root, ".groundrule/standards/x.yaml"),
      "apiVersion: groundrule.dev/v1alpha1\nkind: Pack\nmetadata: { id: p, title: P }\nspec: {}\n",
    );
    const result = await loadWorkspace({ cwd: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toContain('"Standard" or "ActionPolicy"');
  });
});
