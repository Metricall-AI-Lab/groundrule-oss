# ADR 0006: An MCP server for coding agents

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

The best moment to capture a team rule is when a developer corrects their coding agent ("no, we never call Stripe directly, use PaymentsGateway"). Agents speak the Model Context Protocol. The official TypeScript SDK pulls in an HTTP stack (Express, Hono, CORS, JOSE and more) that a local stdio server doesn't need, and this repository keeps dependencies minimal.

## Decision

- **`@groundrule/mcp` implements only what a tools-only stdio server needs, with no dependencies:**
  - JSON-RPC 2.0, newline-delimited;
  - `initialize`, with protocol-version negotiation from 2024-11-05 to 2025-11-25;
  - `notifications/initialized`, `ping`, `tools/list` and `tools/call`;
  - standard error codes;
  - tool failures returned as `isError` results, so the agent can read them.
  It never writes anywhere but the stream it is given.
- **`groundrule mcp` serves two tools.**
  - `list_standards`: the active standards that apply to the repository. It works offline and is read-only.
  - `propose_rule`: sends one sentence, plus an optional reason, example and file:line, to the organization's review inbox through `/v1/cli/proposals`, with the agent's name.
  - The tool descriptions and server instructions tell agents to propose only what the developer stated or agreed should apply to everyone, and never existing rules or one-off preferences.
  - Proposals never change anything until a reviewer accepts them.
- **`groundrule propose` is the same thing for people.**
- **Nothing else leaves the machine.** Only what the developer or agent writes in the proposal is sent, plus the repository name and an optional file and line. No file contents are sent. The platform redacts secrets again.
- **Proposing needs a token scope, `proposals:write`.** `groundrule login` grants it. Older sign-ins are told to log in again.

## Consequences

- One command adds Groundrule to any MCP-capable agent (Claude Code, Cursor, VS Code, and others).
- If the protocol needs resources or prompts later, `@groundrule/mcp` grows those methods. Moving to the SDK stays possible behind the same `Tool` interface.
