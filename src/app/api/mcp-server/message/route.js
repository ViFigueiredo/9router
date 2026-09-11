import { NextResponse } from "next/server";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, listToolDefinitions, callTool } from "@/lib/mcp/serverTools";
import { pushToSession } from "@/lib/mcp/serverSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function authenticate(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return { ok: false, status: 401, message: "Missing API key (send x-api-key or Authorization: Bearer)" };
  const valid = await isValidApiKey(apiKey).catch(() => false);
  if (!valid) return { ok: false, status: 401, message: "Invalid API key" };
  return { ok: true };
}

/**
 * POST /api/mcp-server/message — JSON-RPC 2.0 for the 9Router MCP server.
 * Requires a valid 9Router API key: the tools can read configuration and (when
 * admin tools are enabled) mutate it.
 */
export async function POST(request) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return NextResponse.json(rpcError(null, -32001, auth.message), { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  const respond = (payload) => {
    if (sessionId) pushToSession(sessionId, payload);
    return NextResponse.json(payload);
  };

  if (!body || typeof body !== "object") {
    return respond(rpcError(null, -32700, "Parse error"));
  }

  const { id = null, method, params } = body;

  // Notifications carry no id and expect no response body.
  if (typeof method === "string" && method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return respond(rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      }));

    case "ping":
      return respond(rpcResult(id, {}));

    case "tools/list":
      return respond(rpcResult(id, { tools: listToolDefinitions() }));

    case "tools/call": {
      const name = params?.name;
      if (!name) return respond(rpcError(id, -32602, "Missing tool name"));
      const result = await callTool(name, params?.arguments || {});
      return respond(rpcResult(id, result));
    }

    default:
      return respond(rpcError(id, -32601, `Method not found: ${method}`));
  }
}
