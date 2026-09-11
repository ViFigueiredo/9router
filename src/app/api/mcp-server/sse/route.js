import { registerSession, unregisterSession } from "@/lib/mcp/serverSessions";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mcp-server/sse — MCP SSE handshake.
// Emits the `endpoint` event pointing at the message endpoint for this session and
// keeps the stream alive; JSON-RPC responses are also returned in the POST body so
// clients that read the POST response work without consuming this stream.
export async function GET(request) {
  const apiKey = extractApiKey(request);
  const valid = apiKey ? await isValidApiKey(apiKey).catch(() => false) : false;
  if (!valid) {
    return new Response("Invalid or missing API key", { status: 401 });
  }

  const encoder = new TextEncoder();
  const { origin } = new URL(request.url);
  let sid;
  let keepalive;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch { /* stream already closed */ }
      };
      sid = registerSession(send);
      send(`event: endpoint\ndata: ${origin}/api/mcp-server/message?sessionId=${sid}\n\n`);
      keepalive = setInterval(() => send(": ping\n\n"), 25000);
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      if (sid) unregisterSession(sid);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
