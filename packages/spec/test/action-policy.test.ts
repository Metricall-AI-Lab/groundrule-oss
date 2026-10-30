import { describe, expect, it } from "vitest";
import {
  ActionPolicy,
  AgentAction,
  API_VERSION,
  compareActionEffect,
  GroundruleDocument,
} from "../src/index.js";

const minimal = {
  apiVersion: API_VERSION,
  kind: "ActionPolicy",
  metadata: { id: "ACT-001", title: "Never force-push" },
  spec: {
    severity: "blocker",
    requirement: "Do not force-push.",
    when: { commands: ["git push --force*"] },
  },
};

describe("ActionPolicy", () => {
  it("accepts a minimal policy and fills defaults: ask, active, delivered to agents", () => {
    const parsed = ActionPolicy.parse(minimal);
    expect(parsed.spec.effect).toBe("ask");
    expect(parsed.metadata.status).toBe("active");
    expect(parsed.metadata.version).toBe(1);
    expect(parsed.spec.scope).toEqual({});
    expect(parsed.spec.agent).toEqual({ instruction: true });
  });

  it("is a Groundrule document, told apart by kind", () => {
    const doc = GroundruleDocument.parse(minimal);
    expect(doc.kind).toBe("ActionPolicy");
  });

  it("needs at least one match field, so a policy never matches everything by accident", () => {
    const result = ActionPolicy.safeParse({ ...minimal, spec: { ...minimal.spec, when: {} } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("at least one of");
  });

  it("rejects unknown effects, kinds, and fields a Standard has but a policy doesn't", () => {
    expect(
      ActionPolicy.safeParse({ ...minimal, spec: { ...minimal.spec, effect: "block" } }).success,
    ).toBe(false);
    expect(
      ActionPolicy.safeParse({ ...minimal, spec: { ...minimal.spec, when: { actions: ["run"] } } })
        .success,
    ).toBe(false);
    expect(
      ActionPolicy.safeParse({ ...minimal, spec: { ...minimal.spec, checks: [] } }).success,
    ).toBe(false);
  });

  it("orders effects allow < ask < deny", () => {
    expect(compareActionEffect("deny", "ask")).toBeGreaterThan(0);
    expect(compareActionEffect("allow", "ask")).toBeLessThan(0);
    expect(compareActionEffect("ask", "ask")).toBe(0);
  });
});

describe("AgentAction report", () => {
  it("carries the kind of action and the policy ids, and nothing the agent sent", () => {
    const parsed = AgentAction.parse({
      apiVersion: API_VERSION,
      kind: "AgentAction",
      metadata: { generatedAt: "2026-10-30T09:12:04Z", cliVersion: "0.24.0" },
      repository: { name: "acme/payments-api" },
      agent: { name: "claude-code", via: "hook" },
      action: "shell",
      decision: "deny",
      policies: [{ id: "ACT-001", effect: "deny" }],
    });
    expect(parsed.policies[0]?.id).toBe("ACT-001");
    expect(
      AgentAction.safeParse({
        ...parsed,
        command: "git push --force",
      }).success,
    ).toBe(false);
    expect(AgentAction.safeParse({ ...parsed, decision: "allow" }).success).toBe(false);
  });
});
