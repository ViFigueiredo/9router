import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  listToolDefinitions: vi.fn(),
  callTool: vi.fn(),
  pushToSession: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/lib/mcp/serverTools", () => ({
  MCP_SERVER_NAME: "9router",
  MCP_SERVER_VERSION: "0.0.0-test",
  listToolDefinitions: mocks.listToolDefinitions,
  callTool: mocks.callTool,
}));

vi.mock("@/lib/mcp/serverSessions", () => ({
  pushToSession: mocks.pushToSession,
}));

const post = (body, { key = "sk-test", url = "http://localhost/api/mcp-server/message" } = {}) => {
  mocks.extractApiKey.mockReturnValue(key);
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
};

const call = async (body, options) => {
  const { POST } = await import("../../src/app/api/mcp-server/message/route.js");
  const res = await POST(post(body, options));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

describe("MCP server JSON-RPC endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.isValidApiKey.mockResolvedValue(true);
    mocks.listToolDefinitions.mockReturnValue([{ name: "list_providers", description: "d", inputSchema: { type: "object" } }]);
    mocks.callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  });

  it("rejects requests without a key", async () => {
    const { status, body } = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { key: null });
    expect(status).toBe(401);
    expect(body.error.message).toContain("Missing API key");
  });

  it("rejects an invalid key", async () => {
    mocks.isValidApiKey.mockResolvedValue(false);
    const { status, body } = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(status).toBe(401);
    expect(body.error.message).toContain("Invalid API key");
  });

  it("answers initialize with server info and protocol version", async () => {
    const { status, body } = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(status).toBe(200);
    expect(body.result.serverInfo).toEqual({ name: "9router", version: "0.0.0-test" });
    expect(body.result.protocolVersion).toBeTruthy();
    expect(body.result.capabilities.tools).toBeTruthy();
  });

  it("lists tools", async () => {
    const { body } = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(body.id).toBe(2);
    expect(body.result.tools[0].name).toBe("list_providers");
  });

  it("dispatches tools/call and returns the tool payload", async () => {
    const { body } = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_ranking", arguments: { limit: 5 } } });
    expect(mocks.callTool).toHaveBeenCalledWith("get_ranking", { limit: 5 });
    expect(body.result.content[0].text).toBe("ok");
  });

  it("reports a missing tool name as an invalid params error", async () => {
    const { body } = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: {} });
    expect(body.error.code).toBe(-32602);
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("rejects unknown methods and malformed payloads", async () => {
    const unknown = await call({ jsonrpc: "2.0", id: 5, method: "resources/list" });
    expect(unknown.body.error.code).toBe(-32601);

    const broken = await call("{not json");
    expect(broken.body.error.code).toBe(-32700);
  });

  it("accepts notifications with 202 and no body", async () => {
    const { POST } = await import("../../src/app/api/mcp-server/message/route.js");
    const res = await POST(post({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("mirrors responses into the SSE session when one is provided", async () => {
    await call({ jsonrpc: "2.0", id: 7, method: "ping" }, { url: "http://localhost/api/mcp-server/message?sessionId=abc" });
    expect(mocks.pushToSession).toHaveBeenCalledWith("abc", expect.objectContaining({ id: 7 }));
  });
});
