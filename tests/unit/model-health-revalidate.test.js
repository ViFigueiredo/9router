import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getProviderModels } from "open-sse/config/providerModels.js";

const mocks = vi.hoisted(() => ({
  getCustomModels: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  getModelInfo: vi.fn(),
  recordObservation: vi.fn(),
  getHealthSnapshot: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getCustomModels: mocks.getCustomModels,
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("@/lib/modelHealth/sink.js", () => ({
  recordObservation: mocks.recordObservation,
  getHealthSnapshot: mocks.getHealthSnapshot,
}));

// "openai" is a real registry provider (non-compatible branch) — the model list
// comes from the real open-sse registry, so assertions are shape-based rather
// than hard-coded model ids.
const REGISTRY = getProviderModels("openai");
const modelId = (m) => m.id || m.name;
const kindOf = (m) => m.kind || m.type || "llm";
const ALL_IDS = REGISTRY.map(modelId);
const CHAT_IDS = REGISTRY.filter((m) => kindOf(m) === "llm").map(modelId);
const EMBEDDING_IDS = REGISTRY.filter((m) => kindOf(m) === "embedding").map(modelId);
const IMAGE_IDS = REGISTRY.filter((m) => kindOf(m) === "image").map(modelId);
// `stt` and `tts` have their own branches in pingModelByKind and resolve to the
// mocked 500 (audio endpoints have no deterministic mock); `video` is skipped
// without a request, so it is not asserted here.
const AUDIO_STT_IDS = REGISTRY.filter((m) => kindOf(m) === "stt").map(modelId);
const AUDIO_TTS_IDS = REGISTRY.filter((m) => kindOf(m) === "tts").map(modelId);

const originalFetch = global.fetch;

describe("revalidateProviderModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.getModelInfo.mockImplementation(async (full) => {
      const [provider, ...rest] = String(full).split("/");
      return { provider, model: rest.join("/") };
    });
    mocks.recordObservation.mockResolvedValue();
    mocks.getHealthSnapshot.mockResolvedValue({});
    // Registry kinds vary: chat/embedding/image have deterministic mocks; the
    // audio endpoints (stt/tts) have none, so they resolve to a failing 500.
    global.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/api/v1/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { completion_tokens: 2 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.endsWith("/api/v1/embeddings")) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.endsWith("/api/v1/images/generations")) {
        return new Response(JSON.stringify({ data: [{ b64_json: "abc" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { message: "mocked unavailable" } }),
        { status: 500, headers: { "Content-Type": "application/json" } });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("pings every registry model through the kind-routed internal endpoint and records observations", async () => {
    const { revalidateProviderModels } = await import("../../src/lib/modelHealth/revalidate.js");

    const out = await revalidateProviderModels("openai", { connectionId: "conn-1" });

    expect(out.empty).toBeUndefined();
    expect(out.provider).toBe("openai");
    expect(out.connectionId).toBe("conn-1");
    expect(out.results.map((r) => r.modelId)).toEqual(ALL_IDS);
    for (const id of [...CHAT_IDS, ...EMBEDDING_IDS, ...IMAGE_IDS]) {
      expect(out.results.find((r) => r.modelId === id).ok).toBe(true);
    }
    for (const id of [...AUDIO_STT_IDS, ...AUDIO_TTS_IDS]) {
      expect(out.results.find((r) => r.modelId === id).ok).toBe(false);
    }
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/chat/completions"),
      expect.objectContaining({ method: "POST" })
    );
    expect(mocks.recordObservation).toHaveBeenCalledTimes(ALL_IDS.length);
    expect(mocks.recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: CHAT_IDS[0],
      kind: "llm",
      ok: true,
      isPing: true,
    }));
  });

  it("tags each result from the recomputed health snapshot", async () => {
    const { revalidateProviderModels } = await import("../../src/lib/modelHealth/revalidate.js");
    mocks.getHealthSnapshot.mockResolvedValue({ [CHAT_IDS[0]]: { tag: "failing" } });

    const out = await revalidateProviderModels("openai", { connectionId: "conn-1" });

    expect(out.results.find((r) => r.modelId === CHAT_IDS[0]).tag).toBe("failing");
  });

  it("does not probe or record health for kinds without a cheap probe (video)", async () => {
    const { revalidateProviderModels } = await import("../../src/lib/modelHealth/revalidate.js");
    const xai = getProviderModels("xai");
    const videoIds = xai.filter((m) => kindOf(m) === "video").map(modelId);
    const probedCount = xai.length - videoIds.length;
    expect(videoIds.length).toBeGreaterThan(0);

    const out = await revalidateProviderModels("xai", { connectionId: "conn-1" });

    for (const id of videoIds) {
      const r = out.results.find((x) => x.modelId === id);
      expect(r.skipped).toBe(true);
      expect(r.ok).toBe(false);
    }
    expect(mocks.recordObservation).toHaveBeenCalledTimes(probedCount);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes("/api/v1/videos"))).toBe(false);
  });

  it("returns empty:true and records nothing when the provider has no models", async () => {
    const { revalidateProviderModels } = await import("../../src/lib/modelHealth/revalidate.js");

    const out = await revalidateProviderModels("provider-with-no-models-xyz", { connectionId: "conn-1" });

    expect(out).toEqual({ provider: "provider-with-no-models-xyz", connectionId: "conn-1", results: [], empty: true });
    expect(mocks.recordObservation).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
