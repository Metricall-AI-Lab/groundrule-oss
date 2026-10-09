/**
 * A minimal Model Context Protocol server: JSON-RPC 2.0 over stdio (newline-delimited),
 * tools only. Written without the SDK to keep the CLI dependency-free; it implements the
 * parts of the protocol a tools-only server needs.
 */

/** Protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface ClientInfo {
  name: string;
  version?: string;
}

export interface ToolResult {
  /** Shown to the model. */
  text: string;
  isError?: boolean;
  /** Optional machine-readable result (structuredContent). */
  structured?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  title?: string;
  description: string;
  /** JSON Schema for the arguments (type: object). */
  inputSchema: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** Validate arguments yourself; throw or return isError for bad input. */
  handler(
    args: Record<string, unknown>,
    context: { client: ClientInfo | null },
  ): Promise<ToolResult>;
}

export interface ServerOptions {
  name: string;
  version: string;
  /** Guidance for the model on how to use this server. */
  instructions?: string;
  tools: readonly Tool[];
  /** Diagnostics (never stdout, which carries the protocol). */
  log?: (message: string) => void;
}

type Id = string | number | null;
interface Request {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const error = (id: Id, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message },
});
const result = (id: Id, value: unknown) => ({ jsonrpc: "2.0" as const, id, result: value });

export function createServer(options: ServerOptions) {
  const tools = new Map(options.tools.map((t) => [t.name, t]));
  let client: ClientInfo | null = null;

  async function handleOne(message: unknown): Promise<object | null> {
    if (!message || typeof message !== "object" || Array.isArray(message))
      return error(null, INVALID_REQUEST, "Invalid request");
    const m = message as Partial<Request>;
    const id = m.id === undefined ? undefined : (m.id as Id);
    if (m.jsonrpc !== "2.0" || typeof m.method !== "string")
      // Responses from the client (we send no requests) and malformed messages.
      return id === undefined ? null : error(id, INVALID_REQUEST, "Invalid request");
    // Notifications get no response.
    if (id === undefined) return null;
    const params = (m.params ?? {}) as Record<string, unknown>;
    try {
      switch (m.method) {
        case "initialize": {
          const requested = String(params.protocolVersion ?? "");
          const info = params.clientInfo as ClientInfo | undefined;
          if (info && typeof info.name === "string")
            client = { name: info.name, ...(info.version ? { version: info.version } : {}) };
          return result(id, {
            protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: options.name, version: options.version },
            ...(options.instructions ? { instructions: options.instructions } : {}),
          });
        }
        case "ping":
          return result(id, {});
        case "tools/list":
          return result(id, {
            tools: options.tools.map((t) => ({
              name: t.name,
              ...(t.title ? { title: t.title } : {}),
              description: t.description,
              inputSchema: t.inputSchema,
              ...(t.annotations ? { annotations: t.annotations } : {}),
            })),
          });
        case "tools/call": {
          const name = params.name;
          const tool = typeof name === "string" ? tools.get(name) : undefined;
          if (!tool) return error(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`);
          const args = params.arguments;
          if (
            args !== undefined &&
            (typeof args !== "object" || args === null || Array.isArray(args))
          )
            return error(id, INVALID_PARAMS, "Tool arguments must be an object");
          let out: ToolResult;
          try {
            out = await tool.handler((args ?? {}) as Record<string, unknown>, { client });
          } catch (e) {
            // Tool failures are results the model can read and act on.
            out = { text: e instanceof Error ? e.message : String(e), isError: true };
          }
          return result(id, {
            content: [{ type: "text", text: out.text }],
            ...(out.structured ? { structuredContent: out.structured } : {}),
            isError: out.isError === true,
          });
        }
        default:
          return error(id, METHOD_NOT_FOUND, `Method not found: ${m.method}`);
      }
    } catch (e) {
      options.log?.(`mcp: ${m.method} failed: ${e instanceof Error ? e.message : String(e)}`);
      return error(id, INTERNAL_ERROR, "Internal error");
    }
  }

  /** Handle one parsed message (or a batch); returns what to send back, if anything. */
  async function handle(message: unknown): Promise<object | null> {
    if (Array.isArray(message)) {
      if (message.length === 0) return error(null, INVALID_REQUEST, "Empty batch");
      const replies = (await Promise.all(message.map(handleOne))).filter((r) => r !== null);
      return replies.length ? replies : null;
    }
    return handleOne(message);
  }

  /** Serve newline-delimited JSON-RPC until the input ends. */
  async function serve(
    input: AsyncIterable<string | Uint8Array>,
    output: { write(text: string): unknown },
  ): Promise<void> {
    const decoder = new TextDecoder();
    const pending = new Set<Promise<void>>();
    let buffer = "";
    const send = (reply: object | null) => {
      if (reply) output.write(`${JSON.stringify(reply)}\n`);
    };
    const onLine = (line: string) => {
      if (!line.trim()) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        send(error(null, PARSE_ERROR, "Parse error"));
        return;
      }
      const job = handle(message)
        .then(send)
        .finally(() => pending.delete(job));
      pending.add(job);
    };
    for await (const chunk of input) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        onLine(buffer.slice(0, at).replace(/\r$/, ""));
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
      }
    }
    onLine(buffer);
    await Promise.all(pending);
  }

  return { handle, serve };
}
