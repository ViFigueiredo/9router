import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getApiKeys: mocks.getApiKeys }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));

const originalFetch = global.fetch;

describe("pingModelByKind kind routing (tts / video)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes tts models through /api/v1/audio/speech and passes on audio bytes", async () => {
    global.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]),
      { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

    const result = await pingModelByKind("openai/tts-1", "tts", "http://127.0.0.1:20128", 5000);

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:20128/api/v1/audio/speech");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ model: "openai/tts-1", input: "test" });
  });

  it("fails tts when the provider errors", async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "no such voice" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }));
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

    const result = await pingModelByKind("openai/tts-1", "tts", "http://127.0.0.1:20128", 5000);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("no such voice");
  });

  it("fails tts when the response carries no audio", async () => {
    global.fetch = vi.fn(async () => new Response(new Uint8Array([]),
      { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

    const result = await pingModelByKind("openai/tts-1", "tts", "http://127.0.0.1:20128", 5000);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no audio data");
  });

  it("skips video models without issuing any request", async () => {
    global.fetch = vi.fn(async () => { throw new Error("must not be called"); });
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

    const result = await pingModelByKind("xai/grok-imagine-video", "video", "http://127.0.0.1:20128", 5000);

    expect(result).toMatchObject({ ok: false, skipped: true, status: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
