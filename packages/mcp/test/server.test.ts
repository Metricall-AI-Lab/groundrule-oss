import { describe, expect, it } from "vitest";
import { createServer, PROTOCOL_VERSIONS, type Tool } from "../src/index.js";

const echo: Tool = {
  name: "echo",
  title: "Echo",
  description: "Repeats its input.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  annotations: { readOnlyHint: true },
  async handler(args, { client }) {
    if (typeof args.text !== "string") return { text: "text is required", isError: true };
    return { text: `${client?.name ?? "?"}: ${args.text}`, structured: { text: args.text } };
  },
};
const boom: Tool = {
  name: "boom",
  description: "Fails.",
  inputSchema: { type: "object" },
  async handler() {
    throw new Error("Something specific went wrong.");
  },
};

const server = () =>
  createServer({
    name: "groundrule",
    version: "1.2.3",
    instructions: "Be nice.",
    tools: [echo, boom],
  });

describe("mcp server", () => {
  it("negotiates the protocol version and describes itself", async () => {
    const s = server();
    expect(
      await s.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "claude-code", version: "2.1" },
        },
      }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "groundrule", version: "1.2.3" },
        instructions: "Be nice.",
      },
    });
    const unknown = (await s.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    })) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await s.handle({ jsonrpc: "2.0", id: "p", method: "ping" })).toEqual({
      jsonrpc: "2.0",
      id: "p",
      result: {},
    });
  });

  it("lists and calls tools, passing the client along", async () => {
    const s = server();
    await s.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", clientInfo: { name: "cursor" } },
    });
    const list = (await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools[0]).toEqual({
      name: "echo",
      title: "Echo",
      description: "Repeats its input.",
      inputSchema: echo.inputSchema,
      annotations: { readOnlyHint: true },
    });
    expect(
      await s.handle({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hi" } },
      }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: [{ type: "text", text: "cursor: hi" }],
        structuredContent: { text: "hi" },
        isError: false,
      },
    });
  });

  it("reports tool failures as results and protocol errors as errors", async () => {
    const s = server();
    expect(
      await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boom" } }),
    ).toMatchObject({
      result: {
        content: [{ type: "text", text: "Something specific went wrong." }],
        isError: true,
      },
    });
    expect(
      await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope" } }),
    ).toMatchObject({ error: { code: -32602 } });
    expect(
      await s.handle({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: [1] },
      }),
    ).toMatchObject({ error: { code: -32602 } });
    expect(await s.handle({ jsonrpc: "2.0", id: 4, method: "resources/list" })).toMatchObject({
      error: { code: -32601 },
    });
    expect(await s.handle({ id: 5, method: "ping" })).toMatchObject({ error: { code: -32600 } });
    expect(await s.handle({ jsonrpc: "2.0", id: 6, result: {} })).toMatchObject({
      error: { code: -32600 },
    });
    expect(await s.handle([])).toMatchObject({ error: { code: -32600 } });
  });

  it("serves newline-delimited JSON over streams, including split chunks and bad lines", async () => {
    const s = server();
    const lines = [
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
      "not json\n",
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","argu',
      'ments":{"text":"split"}}}\r\n',
      '[{"jsonrpc":"2.0","id":3,"method":"ping"},{"jsonrpc":"2.0","method":"x"}]',
    ];
    async function* input() {
      for (const l of lines) yield new TextEncoder().encode(l);
    }
    const out: string[] = [];
    await s.serve(input(), { write: (t: string) => out.push(t) });
    const replies = out.map((t) => JSON.parse(t));
    expect(out.every((t) => t.endsWith("\n") && !t.slice(0, -1).includes("\n"))).toBe(true);
    expect(replies).toEqual(
      expect.arrayContaining([
        { jsonrpc: "2.0", id: 1, result: {} },
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        expect.objectContaining({
          id: 2,
          result: expect.objectContaining({ content: [{ type: "text", text: "?: split" }] }),
        }),
        [{ jsonrpc: "2.0", id: 3, result: {} }],
      ]),
    );
    expect(replies).toHaveLength(4);
  });
});
