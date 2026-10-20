import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpAuthProvider } from "./auth";
import { createMcpServer } from "./server";

type McpSession = { server: ReturnType<typeof createMcpServer>; transport: WebStandardStreamableHTTPServerTransport; lastSeenAt: number };
const sessions = new Map<string, McpSession>();
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_MCP_SESSIONS = 1_000;

function pruneExpiredSessions(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (now - session.lastSeenAt > SESSION_IDLE_TTL_MS) {
      sessions.delete(id);
      void session.server.close().catch(() => undefined);
    }
  }
}

export type McpHttpDependencies = { authenticate: McpAuthProvider };

/** Authenticates every HTTP request, including requests on established MCP
 * sessions. Sessions contain protocol state only, never tenant data. */
export async function handleMcpHttpRequest(request: Request, dependencies: McpHttpDependencies): Promise<Response> {
  pruneExpiredSessions();
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;

  const sessionId = request.headers.get("mcp-session-id");
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!sessionId && request.method === "POST") {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Invalid JSON" }, id: null }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!isInitializeRequest(body)) {
      return new Response("MCP session is required", { status: 400 });
    }
    if (sessions.size >= MAX_MCP_SESSIONS) return new Response("MCP session capacity reached", { status: 503 });
    const server = createMcpServer();
    let initializedSessionId: string | undefined;
    let transport!: WebStandardStreamableHTTPServerTransport;
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        initializedSessionId = id;
        sessions.set(id, { server, transport, lastSeenAt: Date.now() });
      },
      onsessionclosed: (id) => { sessions.delete(id); },
    });
    session = { server, transport, lastSeenAt: Date.now() };
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // Defensive fallback for SDK releases that set the ID before invoking the callback.
    if (initializedSessionId && !sessions.has(initializedSessionId)) sessions.set(initializedSessionId, session);
    return response;
  }

  if (!session || !sessionId) return new Response("MCP session not found", { status: 404 });
  session.lastSeenAt = Date.now();
  return session.transport.handleRequest(request);
}

export function resetMcpSessionsForTests() {
  sessions.clear();
}
