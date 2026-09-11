import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  testSingleConnection: vi.fn(),
  revalidateProviderModels: vi.fn(),
}));

vi.mock("@/lib/db/index.js", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/app/api/providers/[id]/test/testUtils.js", () => ({
  testSingleConnection: mocks.testSingleConnection,
}));

vi.mock("@/lib/modelHealth/revalidate.js", () => ({
  revalidateProviderModels: mocks.revalidateProviderModels,
}));

const SETTINGS = { providerRevalidation: { openai: { enabled: true, intervalMinutes: 30 } } };

function freshState() {
  return { interval: null, nextRunAt: {}, running: new Set(), runningTick: false };
}

describe("normalizeIntervalMinutes", () => {
  it("clamps into [5, 60] and falls back to 30", async () => {
    const { normalizeIntervalMinutes } = await import("../../src/shared/services/providerRevalidation.js");
    expect(normalizeIntervalMinutes(1)).toBe(5);
    expect(normalizeIntervalMinutes(600)).toBe(60);
    expect(normalizeIntervalMinutes("45")).toBe(45);
    expect(normalizeIntervalMinutes(undefined)).toBe(30);
    expect(normalizeIntervalMinutes("abc")).toBe(30);
  });
});

describe("scheduling", () => {
  it("newly enabled providers are due immediately; disabled ones are dropped", async () => {
    const { scheduleFrom, computeDueProviderIds } = await import("../../src/shared/services/providerRevalidation.js");
    const state = freshState();

    scheduleFrom(SETTINGS, state, 1000);
    expect(state.nextRunAt.openai).toBe(1000);
    expect(computeDueProviderIds(SETTINGS, state, 1500)).toEqual(["openai"]);

    state.nextRunAt.openai = 5000;
    expect(computeDueProviderIds(SETTINGS, state, 4999)).toEqual([]);
    expect(computeDueProviderIds(SETTINGS, state, 5000)).toEqual(["openai"]);

    state.running.add("openai");
    expect(computeDueProviderIds(SETTINGS, state, 9000)).toEqual([]);

    scheduleFrom({ providerRevalidation: {} }, state, 10000);
    expect(state.nextRunAt.openai).toBeUndefined();
  });

  it("ignores providers without an explicit enabled flag", async () => {
    const { enabledProviderIds } = await import("../../src/shared/services/providerRevalidation.js");
    expect(enabledProviderIds({
      providerRevalidation: { a: { enabled: true }, b: { enabled: false }, c: {}, d: null },
    })).toEqual(["a"]);
  });
});

describe("revalidateProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(SETTINGS);
    mocks.updateSettings.mockResolvedValue({});
  });

  it("skips model pings and reports error when every credential fails", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1", name: "main" }]);
    mocks.testSingleConnection.mockResolvedValue({ valid: false, error: "401 unauthorized" });
    mocks.revalidateProviderModels.mockResolvedValue({ results: [] });
    const { revalidateProvider } = await import("../../src/shared/services/providerRevalidation.js");

    const res = await revalidateProvider("openai", mocks, freshState());

    expect(res.status).toBe("error");
    expect(mocks.revalidateProviderModels).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      providerRevalidation: expect.objectContaining({
        openai: expect.objectContaining({ lastStatus: "error" }),
      }),
    }));
  });

  it("reports error without touching credentials when there are no active connections", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const { revalidateProvider } = await import("../../src/shared/services/providerRevalidation.js");

    const res = await revalidateProvider("openai", mocks, freshState());

    expect(res.status).toBe("error");
    expect(mocks.testSingleConnection).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      providerRevalidation: expect.objectContaining({
        openai: expect.objectContaining({ lastError: "no active connections" }),
      }),
    }));
  });

  it("falls back to the next connection and reports ok when all models pass", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mocks.testSingleConnection
      .mockResolvedValueOnce({ valid: false, error: "expired" })
      .mockResolvedValueOnce({ valid: true });
    mocks.revalidateProviderModels.mockResolvedValue({ results: [{ ok: true }, { ok: true }] });
    const { revalidateProvider } = await import("../../src/shared/services/providerRevalidation.js");

    const res = await revalidateProvider("openai", mocks, freshState());

    expect(res.status).toBe("ok");
    expect(mocks.revalidateProviderModels).toHaveBeenCalledWith("openai", { connectionId: "c2" });
    expect(mocks.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      providerRevalidation: expect.objectContaining({
        openai: expect.objectContaining({ lastStatus: "ok", lastError: null }),
      }),
    }));
  });

  it("reports partial when some models fail", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1" }]);
    mocks.testSingleConnection.mockResolvedValue({ valid: true });
    mocks.revalidateProviderModels.mockResolvedValue({ results: [{ ok: true }, { ok: false }] });
    const { revalidateProvider } = await import("../../src/shared/services/providerRevalidation.js");

    const res = await revalidateProvider("openai", mocks, freshState());

    expect(res.status).toBe("partial");
  });

  it("clears the in-flight guard even when the cycle throws", async () => {
    mocks.getProviderConnections.mockRejectedValue(new Error("db down"));
    const state = freshState();
    const { revalidateProvider } = await import("../../src/shared/services/providerRevalidation.js");

    const res = await revalidateProvider("openai", mocks, state);

    expect(res.status).toBe("error");
    expect(state.running.has("openai")).toBe(false);
  });
});

describe("runProviderRevalidationTick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(SETTINGS);
    mocks.updateSettings.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([{ id: "c1" }]);
    mocks.testSingleConnection.mockResolvedValue({ valid: true });
    mocks.revalidateProviderModels.mockResolvedValue({ results: [{ ok: true }] });
  });

  it("runs due providers once and backs off by the configured interval", async () => {
    const { runProviderRevalidationTick } = await import("../../src/shared/services/providerRevalidation.js");
    const state = freshState();

    await runProviderRevalidationTick(mocks, state);
    expect(mocks.revalidateProviderModels).toHaveBeenCalledTimes(1);
    expect(state.nextRunAt.openai).toBeGreaterThan(Date.now() + 29 * 60_000);

    await runProviderRevalidationTick(mocks, state);
    expect(mocks.revalidateProviderModels).toHaveBeenCalledTimes(1); // not due anymore
  });

  it("keeps ticking other providers when one cycle fails", async () => {
    mocks.getSettings.mockResolvedValue({
      providerRevalidation: {
        broken: { enabled: true, intervalMinutes: 5 },
        healthy: { enabled: true, intervalMinutes: 5 },
      },
    });
    mocks.getProviderConnections.mockImplementation(async ({ provider }) => {
      if (provider === "broken") throw new Error("db down");
      return [{ id: "c1" }];
    });
    const { runProviderRevalidationTick } = await import("../../src/shared/services/providerRevalidation.js");
    const state = freshState();

    await runProviderRevalidationTick(mocks, state);

    expect(mocks.revalidateProviderModels).toHaveBeenCalledTimes(1);
    expect(state.nextRunAt.broken).toBeGreaterThan(0);
    expect(state.nextRunAt.healthy).toBeGreaterThan(0);
    expect(state.runningTick).toBe(false);
  });
});
