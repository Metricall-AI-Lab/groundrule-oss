# @groundrule/mcp

A small [Model Context Protocol](https://modelcontextprotocol.io) server: JSON-RPC 2.0 over stdio, tools only, no dependencies. `groundrule mcp` uses it to let coding agents read your standards and propose new rules. See the CLI's README for setup.

It implements `initialize` (with protocol-version negotiation), `notifications/initialized`, `ping`, `tools/list`, and `tools/call`. Tool failures are returned as tool results with `isError: true`, so the agent can read them; protocol errors use JSON-RPC error codes.
