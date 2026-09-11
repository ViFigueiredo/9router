// In-memory SSE session registry for the 9Router MCP server. The app runs as a
// single Node process, so a module-level map is enough; sessions are dropped when
// the stream closes.
const sessions = new Map();
let counter = 0;

export function registerSession(send) {
  counter += 1;
  const id = `mcp-${Date.now().toString(36)}-${counter}`;
  sessions.set(id, send);
  return id;
}

export function unregisterSession(id) {
  sessions.delete(id);
}

export function pushToSession(id, payload) {
  const send = sessions.get(id);
  if (!send) return false;
  try {
    send(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    sessions.delete(id);
    return false;
  }
}

export function sessionCount() {
  return sessions.size;
}
