# Provider/Model Auto-Revalidation Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Background service that periodically re-validates each provider's credentials and models, with a per-provider interval (5–60 min) configured in the provider page UI.

**Architecture:** One in-process `setInterval` tick (60s) + per-provider `nextRunAt` map, mirroring `quotaAutoPing.js`. The model-list/ping logic is extracted from the `test-models` route into `src/lib/modelHealth/revalidate.js` and reused by both the route and the worker. Config lives in the global settings JSON under `providerRevalidation`.

**Tech Stack:** Plain JS (ESM), Next.js App Router, SQLite kv/settings via `src/lib/db`, vitest (tests live in the independent `tests/` package).

**Spec:** `docs/superpowers/specs/2026-09-11-provider-revalidation-worker-design.md`

## Global Constraints

- No new dependencies.
- `intervalMinutes` clamped to `[5, 60]`, fallback `30` — must stay ≤ the 1h model-health window so badges never lapse to `unknown`.
- Opt-in: absent `providerRevalidation` entry = disabled. Default `{}`.
- All paths English literals in the provider page control strip (matches "Round Robin" / "Sticky:" neighbors); no new i18n keys.
- Worker logs prefixed `[Revalidate]`, `console.log`/`console.warn`, matching `[AutoPing]`.
- Fail-open: worker errors never throw out of the tick; `recordObservation` already swallows.
- Conventional Commits for every task.
- Test commands run from `tests/` (vitest config resolves `@/` and `open-sse` aliases to the repo root): `cd tests && npx vitest run unit/<file>`.

---

### Task 1: Extract model revalidation from test-models route

**Files:**
- Create: `src/lib/modelHealth/revalidate.js`
- Modify: `src/app/api/providers/[id]/test-models/route.js` (replace body with thin wrapper)
- Test: `tests/unit/model-health-revalidate.test.js` (new)

**Interfaces:**
- Consumes: `pingModelByKind(modelStr, kind, baseUrl, timeoutMs)`, `recordObservation(...)`, `getHealthSnapshot(provider)`, `mapWithConcurrency(items, n, fn)`, `getCustomModels()`, `getProviderModels(alias)`, `PROVIDER_ID_TO_ALIAS`, `getModelInfo(fullModel)`.
- Produces (used by Task 2 and the route):
  - `resolveInternalBaseUrl() -> string`
  - `listProviderModels(providerId, { connectionId, baseUrl }) -> Promise<Array<{id,name,kind}>>`
  - `revalidateProviderModels(providerId, { connectionId, baseUrl }) -> Promise<{ provider, connectionId, results: Array<{modelId,name,kind,ok,latencyMs,status,tps,error,inconclusive?,tag}>, empty?: true }>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/model-health-revalidate.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomModels: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  getModelInfo: vi.fn(),
  recordObservation: vi.fn(),
  getHealthSnapshot: vi.fn(),
  getProviderModels: vi.fn(),
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

vi.mock("open-sse/config/providerModels.js", () => ({
  getProviderModels: mocks.getProviderModels,
  PROVIDER_ID_TO_ALIAS: { openai: "openai" },
}));

vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: () => false,
  isAnthropicCompatibleProvider: () => false,
}));

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
    mocks.getHealthSnapshot.mockResolvedValue({ "m-a": { tag: "ok" }, "m-b": { tag: "failing" } });
    mocks.recordObservation.mockResolvedValue();
    mocks.getProviderModels.mockReturnValue([{ id: "m-a", name: "A" }, { id: "m-b" }]);
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { completion_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("pings every model through the internal chat endpoint and records observations", async () => {
    const { revalidateProviderModels } = await import("../../src/lib/modelHealth/revalidate.js");

    const out = await revalidateProviderModels("openai", { connectionId: "conn-1" });

    expect(out.empty).toBeUndefined();
    expect(out.provider).toBe("openai");
    expect(out.connectionId).toBe("conn-1");
    expect(out.results.map((r) => r.modelId)).toEqual(["m-a", "m-b"]);
    expect(out.results.every((r) => r.ok === true)).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/chat/completions"),
      expect.objectContaining({ method: "POST" })
    );
    expect(mocks.recordObservation).toHaveBeenCalledTimes(2);
    expect(mocks.recordObservation).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "m-a",
      kind: "llm",
      ok: true,
      isPing: true,
    }));
  });

  it("tags each result from the recomputed health snapshot", async () => {
    const { revalidateProviderModels } = await import("../../src/lib/modelHealth/revalidate.js");

    const out = await revalidateProviderModels("openai", { connectionId: "conn-1" });

    expect(out.results.find((r) => r.modelId === "m-a").tag).toBe("ok");
    expect(out.results.find((r) => r.modelId === "m-b").tag).toBe("failing");
  });

  it("returns empty:true and records nothing when the provider has no models", async () => {
    mocks.getProviderModels.mockReturnValue([]);

    const { revalidateProviderModels } = await import("../../src/lib/modelHealth/revalidate.js");

    const out = await revalidateProviderModels("openai", { connectionId: "conn-1" });

    expect(out).toEqual({ provider: "openai", connectionId: "conn-1", results: [], empty: true });
    expect(mocks.recordObservation).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/model-health-revalidate.test.js`
Expected: FAIL — `Cannot find module '../../src/lib/modelHealth/revalidate.js'` (or equivalent resolution error).

- [ ] **Step 3: Create `src/lib/modelHealth/revalidate.js`**

```js
import { getCustomModels } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG, MODEL_TEST_BATCH } from "@/shared/constants/config";
import { mapWithConcurrency } from "@/shared/utils/mapWithConcurrency";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { recordObservation, getHealthSnapshot } from "@/lib/modelHealth/sink.js";
import { getModelInfo } from "@/sse/services/model.js";

export function resolveInternalBaseUrl() {
  return `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
}

/**
 * Resolve the model list for a provider exactly as the provider page shows it:
 * registry models first, then live /models (compatible nodes, resolved through
 * the connection), then the page's custom rows (keyed by the provider id).
 * Registry/live lists may be empty for user-defined compatible nodes — the
 * page's rows are what the user actually sees, so they must be validated too.
 */
export async function listProviderModels(providerId, { connectionId, baseUrl = resolveInternalBaseUrl() } = {}) {
  const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const seenIds = new Set();
  const models = [];
  const pushModel = (m) => {
    const modelId = m.id || m.name || m.model;
    if (!modelId || seenIds.has(modelId)) return;
    seenIds.add(modelId);
    models.push({ id: modelId, name: m.name || modelId, kind: m.kind || m.type || "llm" });
  };

  if (isCompatible) {
    for (const m of getProviderModels(alias)) pushModel(m);
    try {
      const modelsRes = await fetch(`${baseUrl}/api/providers/${connectionId}/models`);
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        for (const m of data.models || []) pushModel(m);
      }
    } catch { /* fallback to registry/custom */ }
    try {
      const custom = await getCustomModels();
      for (const m of custom) {
        if (m.providerAlias !== providerId) continue;
        if ((m.kind || m.type || "llm") !== "llm") continue;
        pushModel(m);
      }
    } catch { /* fallback to registry/live */ }
  } else {
    for (const m of getProviderModels(alias)) pushModel(m);
  }

  return models;
}

/**
 * Ping every model of a provider through the internal endpoints (kind-routed),
 * record each outcome into model health (fail-open) and return results tagged
 * with the recomputed health tag. Shared by the test-models route and the
 * background revalidation worker — keep behavior identical for both callers.
 */
export async function revalidateProviderModels(providerId, { connectionId, baseUrl = resolveInternalBaseUrl() } = {}) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const models = await listProviderModels(providerId, { connectionId, baseUrl });
  if (models.length === 0) {
    return { provider: providerId, connectionId, results: [], empty: true };
  }

  // One slow/hung model must not fail the whole batch: pingModelByKind throws
  // on its own timeout/network errors, so catch per model and turn the failure
  // into a normal result entry (tag → failing). A probe timeout under batch
  // load is not evidence the model is broken — record it without health impact.
  const safePing = async (modelStr, kind) => {
    try {
      return await pingModelByKind(modelStr, kind, baseUrl, MODEL_TEST_BATCH.pingTimeoutMs);
    } catch (err) {
      const message = String(err?.message || err);
      return {
        ok: false,
        latencyMs: null,
        status: null,
        inconclusive: /timeout|aborted/i.test(message),
        error: `ping failed: ${message.slice(0, 240)}`,
      };
    }
  };

  // Warm up with the first model to trigger token refresh (if needed) before
  // the fan-out. This prevents multiple requests concurrently refreshing the
  // same token, and keeps the first upstream hit serial.
  const [first, ...rest] = models;
  const firstKind = first.kind || first.type || "llm";
  const firstResult = await safePing(`${alias}/${first.id}`, firstKind);
  const results = [{ modelId: first.id, name: first.name || first.id, kind: first.kind || first.type || "llm", ...firstResult }];

  if (rest.length > 0) {
    const restResults = await mapWithConcurrency(rest, MODEL_TEST_BATCH.concurrency, async (model) => {
      const result = await safePing(`${alias}/${model.id}`, model.kind || model.type || "llm");
      return { modelId: model.id, name: model.name || model.id, kind: model.kind || model.type || "llm", ...result };
    });
    results.push(...restResults);
  }

  // Record ping outcomes into model health (fail-open) and tag each result.
  let snapshot = {};
  try {
    const seenProviders = new Set([providerId]);
    for (const r of results) {
      const fullModel = `${alias}/${r.modelId}`;
      const info = await getModelInfo(fullModel).catch(() => null);
      const provider = info?.provider || providerId;
      const model = info?.model || r.modelId;
      seenProviders.add(provider);
      await recordObservation({
        provider, model,
        kind: r.kind || "llm",
        ok: !!r.ok,
        status: r.status ?? null,
        ttftMs: typeof r.latencyMs === "number" ? r.latencyMs : null,
        tps: typeof r.tps === "number" ? r.tps : null,
        isPing: true,
        errorText: r.error || "",
        ...(r.inconclusive ? { fatalOverride: false } : {}),
      });
    }
    // Snapshot under every provider we recorded under (alias→id resolution can
    // differ from connection.provider) so the per-result tag lookup below hits.
    snapshot = {};
    for (const p of seenProviders) {
      Object.assign(snapshot, await getHealthSnapshot(p).catch(() => ({})));
    }
  } catch { /* record failures never break the test response */ }

  for (const r of results) {
    const tag = (snapshot[r.modelId] && snapshot[r.modelId].tag) || "unknown";
    r.tag = tag;
  }

  return { provider: providerId, connectionId, results };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/model-health-revalidate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Make the route a thin wrapper (behavior-preserving)**

Replace the entire content of `src/app/api/providers/[id]/test-models/route.js` with:

```js
import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { revalidateProviderModels } from "@/lib/modelHealth/revalidate.js";

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through the internal endpoint that matches each model kind.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const providerId = connection.provider;
    const { results, empty } = await revalidateProviderModels(providerId, { connectionId: id });
    if (empty) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }
    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.log("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run the existing routing test (sibling — must stay green)**

Run: `cd tests && npx vitest run unit/provider-test-models-routing.test.js unit/model-test-routing.test.js unit/model-health-sink.test.js`
Expected: routing test PASSes against the refactored route (same response shape); sink test PASSes.

- [ ] **Step 7: Lint changed files**

Run: `npx eslint src/lib/modelHealth/revalidate.js "src/app/api/providers/[id]/test-models/route.js"`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/modelHealth/revalidate.js "src/app/api/providers/[id]/test-models/route.js" tests/unit/model-health-revalidate.test.js
git commit -m "refactor(model-health): extract provider model revalidation from test-models route"
```

---

### Task 2: Revalidation service + config constants

**Files:**
- Create: `src/shared/services/providerRevalidation.js`
- Modify: `src/shared/constants/config.js` (add `PROVIDER_REVALIDATION_CONFIG` after `MODEL_TEST_BATCH`)
- Modify: `src/lib/db/repos/settingsRepo.js` (add `providerRevalidation: {},` on the line after `providerStrategies: {},` in `DEFAULT_SETTINGS`)
- Test: `tests/unit/provider-revalidation.test.js` (new)

**Interfaces:**
- Consumes: `revalidateProviderModels(providerId, { connectionId })` (Task 1); `testSingleConnection(id) -> { valid, error, refreshed, latencyMs, testedAt }`; `getProviderConnections({ provider, isActive })`; `getSettings()` / `updateSettings(updates)` (shallow merge, whole-map replace per key).
- Produces (used by Task 3 wiring and tests):
  - `normalizeIntervalMinutes(value) -> number`
  - `readProviderConfig(settings, providerId) -> { enabled, intervalMinutes }`
  - `enabledProviderIds(settings) -> string[]`
  - `scheduleFrom(settings, state, nowMs?)`
  - `computeDueProviderIds(settings, state, nowMs?) -> string[]`
  - `revalidateProvider(providerId, deps?, state?) -> { providerId, status: "ok"|"partial"|"error", failed?, error? }`
  - `runProviderRevalidationTick(deps?, state?)`
  - `startProviderRevalidation()` / `stopProviderRevalidation()` / `configureProviderRevalidation(settings)`
  - deps shape: `{ getSettings, updateSettings, getProviderConnections, testSingleConnection, revalidateProviderModels }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/provider-revalidation.test.js`:

```js
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
        openai: expect.objectContaining({ lastStatus: "ok" }),
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
    expect(state.nextRunAt.openai).toBeGreaterThan(Date.now() - 1000);

    await runProviderRevalidationTick(mocks, state);
    expect(mocks.revalidateProviderModels).toHaveBeenCalledTimes(1); // not due anymore
  });

  it("reports error status when the provider has no active connections", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const { runProviderRevalidationTick } = await import("../../src/shared/services/providerRevalidation.js");

    await runProviderRevalidationTick(mocks, freshState());

    expect(mocks.testSingleConnection).not.toHaveBeenCalled();
    expect(mocks.revalidateProviderModels).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      providerRevalidation: expect.objectContaining({
        openai: expect.objectContaining({ lastError: "no active connections" }),
      }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run unit/provider-revalidation.test.js`
Expected: FAIL — cannot resolve `../../src/shared/services/providerRevalidation.js`.

- [ ] **Step 3: Add config constant**

In `src/shared/constants/config.js`, after the `MODEL_TEST_BATCH` block (ends `pingTimeoutMs: 30_000,\n};`), append:

```js
// Provider/model auto-revalidation: periodic background credential + model ping.
export const PROVIDER_REVALIDATION_CONFIG = {
  tickIntervalMs: 60_000,
  minIntervalMinutes: 5,
  // Must stay <= the model-health window (1h) so a healthy badge never lapses
  // to "unknown" between two runs (the classifier prunes events past the window).
  maxIntervalMinutes: 60,
  defaultIntervalMinutes: 30,
};
```

In `src/lib/db/repos/settingsRepo.js`, in `DEFAULT_SETTINGS`, on the line after `providerStrategies: {},` add:

```js
  providerRevalidation: {},
```

- [ ] **Step 4: Create `src/shared/services/providerRevalidation.js`**

```js
// Periodic provider + model revalidation. Opt-in per provider via settings:
//   providerRevalidation: { "<providerId>": { enabled, intervalMinutes, lastRunAt, lastStatus, lastError } }
// Mirrors quotaAutoPing.js: process-singleton tick, configure-from-settings, fail-open.
import { getSettings, updateSettings, getProviderConnections } from "@/lib/db/index.js";
import { testSingleConnection } from "@/app/api/providers/[id]/test/testUtils.js";
import { revalidateProviderModels } from "@/lib/modelHealth/revalidate.js";
import { PROVIDER_REVALIDATION_CONFIG } from "@/shared/constants/config";

const C = PROVIDER_REVALIDATION_CONFIG;

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__providerRevalidation ??= {
  interval: null,
  nextRunAt: {},      // providerId → epoch ms of next allowed run
  running: new Set(), // providerIds with a cycle in flight
  runningTick: false,
});

export function normalizeIntervalMinutes(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return C.defaultIntervalMinutes;
  return Math.min(C.maxIntervalMinutes, Math.max(C.minIntervalMinutes, n));
}

export function readProviderConfig(settings, providerId) {
  const cfg = (settings?.providerRevalidation || {})[providerId] || {};
  return {
    enabled: cfg.enabled === true,
    intervalMinutes: normalizeIntervalMinutes(cfg.intervalMinutes),
  };
}

export function enabledProviderIds(settings) {
  return Object.entries(settings?.providerRevalidation || {})
    .filter(([, cfg]) => cfg && cfg.enabled === true)
    .map(([providerId]) => providerId);
}

// Drop disabled providers from the schedule; newly enabled ones are due on the
// next tick (entry = now), so tags refresh right after the user opts in.
export function scheduleFrom(settings, state = g, nowMs = Date.now()) {
  const enabled = new Set(enabledProviderIds(settings));
  for (const providerId of Object.keys(state.nextRunAt)) {
    if (!enabled.has(providerId)) delete state.nextRunAt[providerId];
  }
  for (const providerId of enabled) {
    if (!(providerId in state.nextRunAt)) state.nextRunAt[providerId] = nowMs;
  }
}

export function computeDueProviderIds(settings, state = g, nowMs = Date.now()) {
  return enabledProviderIds(settings).filter((providerId) => {
    if (state.running.has(providerId)) return false;
    const due = state.nextRunAt[providerId];
    return due == null || due <= nowMs;
  });
}

function createDefaultDeps() {
  return {
    getSettings,
    updateSettings,
    getProviderConnections,
    testSingleConnection,
    revalidateProviderModels,
  };
}

// Best-effort bookkeeping; must never break the cycle.
async function persistResult(deps, providerId, patch) {
  try {
    const settings = await deps.getSettings();
    const current = settings.providerRevalidation || {};
    const prev = current[providerId] || {};
    await deps.updateSettings({
      providerRevalidation: { ...current, [providerId]: { ...prev, ...patch } },
    });
  } catch (e) {
    console.warn(`[Revalidate] ${providerId}: failed to persist status:`, e?.message || e);
  }
}

export async function revalidateProvider(providerId, deps = createDefaultDeps(), state = g) {
  state.running.add(providerId);
  try {
    const conns = (await deps.getProviderConnections({ provider: providerId, isActive: true })) || [];
    if (conns.length === 0) {
      await persistResult(deps, providerId, { lastRunAt: Date.now(), lastStatus: "error", lastError: "no active connections" });
      return { providerId, status: "error", error: "no active connections" };
    }

    // Credential gate: test connections in priority order; models are pinged
    // through the first healthy one only (never N connections × M models). All
    // credentials down → skip model pings entirely (no tokens spent on a
    // broken account).
    let healthy = null;
    const failures = [];
    for (const conn of conns) {
      try {
        const r = await deps.testSingleConnection(conn.id);
        if (r && r.valid) { healthy = conn; break; }
        failures.push(`${conn.name || conn.id}: ${r?.error || "failed"}`);
      } catch (e) {
        failures.push(`${conn.name || conn.id}: ${e?.message || e}`);
      }
    }
    if (!healthy) {
      const msg = `credential check failed (${failures.join("; ").slice(0, 240)})`;
      await persistResult(deps, providerId, { lastRunAt: Date.now(), lastStatus: "error", lastError: msg });
      return { providerId, status: "error", error: msg };
    }

    const out = await deps.revalidateProviderModels(providerId, { connectionId: healthy.id });
    if (out.empty) {
      await persistResult(deps, providerId, { lastRunAt: Date.now(), lastStatus: "error", lastError: "no models configured" });
      return { providerId, status: "error", error: "no models configured" };
    }
    const failed = (out.results || []).filter((r) => !r.ok).length;
    const status = failed === 0 ? "ok" : "partial";
    await persistResult(deps, providerId, { lastRunAt: Date.now(), lastStatus: status, lastError: null });
    return { providerId, status, failed };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 240);
    await persistResult(deps, providerId, { lastRunAt: Date.now(), lastStatus: "error", lastError: msg });
    return { providerId, status: "error", error: msg };
  } finally {
    state.running.delete(providerId);
  }
}

export async function runProviderRevalidationTick(deps = createDefaultDeps(), state = g) {
  if (state.runningTick) return;
  state.runningTick = true;
  try {
    const settings = await deps.getSettings();
    scheduleFrom(settings, state);
    for (const providerId of computeDueProviderIds(settings, state)) {
      const { intervalMinutes } = readProviderConfig(settings, providerId);
      console.log(`[Revalidate] ${providerId}: running (every ${intervalMinutes}min)`);
      const res = await revalidateProvider(providerId, deps, state);
      state.nextRunAt[providerId] = Date.now() + intervalMinutes * 60_000;
      if (res.status === "ok") console.log(`[Revalidate] ${providerId}: ok`);
      else console.warn(`[Revalidate] ${providerId}: ${res.status} ${res.error || ""}`.trim());
    }
  } catch (e) {
    console.warn("[Revalidate] tick error:", e?.message || e);
  } finally {
    state.runningTick = false;
  }
}

export function startProviderRevalidation() {
  if (g.interval) return;
  console.log("[Revalidate] scheduler started");
  g.interval = setInterval(() => { runProviderRevalidationTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

export function stopProviderRevalidation() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[Revalidate] scheduler stopped");
}

export function configureProviderRevalidation(settings) {
  if (enabledProviderIds(settings).length > 0) startProviderRevalidation();
  else stopProviderRevalidation();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests && npx vitest run unit/provider-revalidation.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Lint**

Run: `npx eslint src/shared/services/providerRevalidation.js src/shared/constants/config.js src/lib/db/repos/settingsRepo.js`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/services/providerRevalidation.js src/shared/constants/config.js src/lib/db/repos/settingsRepo.js tests/unit/provider-revalidation.test.js
git commit -m "feat(revalidation): per-provider background revalidation service"
```

---

### Task 3: Boot + settings wiring

**Files:**
- Modify: `src/shared/services/initializeApp.js` (add block in `runHeavyStartup` after the quotaAutoPing import block, and a helper next to `hasQuotaAutoPingEnabled`)
- Modify: `src/app/api/settings/route.js` (add block after the `claudeAutoPing`/`codexAutoPing` block, reusing the same `settings` variable that `updateSettings` returned)

**Interfaces:**
- Consumes: `configureProviderRevalidation(settings)` / `startProviderRevalidation()` (Task 2).
- Produces: scheduler starts on boot when any provider is enabled; PATCH `/api/settings` with `providerRevalidation` reconfigures it live.

- [ ] **Step 1: Wire boot**

In `src/shared/services/initializeApp.js`, inside `runHeavyStartup()` directly after the existing block:

```js
  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((e) => console.log("[AutoPing] scheduler start failed:", e.message));
  }
```

append:

```js
  if (hasProviderRevalidationEnabled(settings)) {
    // Keep the module (and its provider/test-utils graph) out of memory when nobody opted in.
    import("@/shared/services/providerRevalidation")
      .then(({ startProviderRevalidation }) => startProviderRevalidation())
      .catch((e) => console.log("[Revalidate] scheduler start failed:", e.message));
  }
```

Next to the existing `hasQuotaAutoPingEnabled` function, add:

```js
function hasProviderRevalidationEnabled(settings) {
  return Object.values(settings?.providerRevalidation || {}).some((cfg) => cfg?.enabled === true);
}
```

- [ ] **Step 2: Wire settings PATCH**

In `src/app/api/settings/route.js`, directly after the `claudeAutoPing`/`codexAutoPing` block (ends with `.catch((error) => console.warn("[AutoPing] settings update failed:", error.message));`), append:

```js
    if (Object.prototype.hasOwnProperty.call(body, "providerRevalidation")) {
      import("@/shared/services/providerRevalidation")
        .then(({ configureProviderRevalidation }) => {
          configureProviderRevalidation(settings);
        })
        .catch((error) => console.warn("[Revalidate] settings update failed:", error.message));
    }
```

- [ ] **Step 3: Verify imports resolve and no other wiring site exists**

Run: `grep -rn "providerRevalidation" src/ && npx eslint src/shared/services/initializeApp.js src/app/api/settings/route.js`
Expected: hits only in the two wired files + service + settingsRepo; no lint errors.

- [ ] **Step 4: Run the settings-adjacent tests (siblings)**

Run: `cd tests && npx vitest run unit/provider-revalidation.test.js unit/model-health-repo.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/services/initializeApp.js src/app/api/settings/route.js
git commit -m "feat(revalidation): wire scheduler into boot and settings updates"
```

---

### Task 4: Provider page UI

**Files:**
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js`:
  - state decl (after `const [autoPing, setAutoPing] = useState(...)` ~line 70)
  - settings load (after the `setAutoPing(...)` line in the settings fetch, ~line 327)
  - save handlers (after `handleStickyLimitChange`, ~line 412)
  - render (after the Round Robin `</div>`, ~line 1587)

**Interfaces:**
- Consumes: `GET/PATCH /api/settings` (`providerRevalidation` map); `Toggle`, `select` already imported/available in the file.
- Produces: per-provider toggle + interval select (presets 5/10/15/30/60) + last-run readout, shown only when the provider has connections.

- [ ] **Step 1: Add state**

After `const [autoPing, setAutoPing] = useState({ enabled: false, connections: {} });` add:

```js
  const [revalidation, setRevalidation] = useState({ enabled: false, intervalMinutes: 30, lastRunAt: null, lastStatus: null, lastError: null });
```

- [ ] **Step 2: Load config in the existing settings fetch**

After `setAutoPing({ enabled: apCfg.enabled === true, connections: apCfg.connections || {} });` add:

```js
      const rvCfg = (settingsData.providerRevalidation || {})[providerId] || {};
      setRevalidation({
        enabled: rvCfg.enabled === true,
        intervalMinutes: rvCfg.intervalMinutes || 30,
        lastRunAt: rvCfg.lastRunAt || null,
        lastStatus: rvCfg.lastStatus || null,
        lastError: rvCfg.lastError || null,
      });
```

- [ ] **Step 3: Add save handlers (after `handleStickyLimitChange`)**

```js
  const saveRevalidationConfig = async ({ enabled, intervalMinutes }) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerRevalidation || {};
      const prev = current[providerId] || {};
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerRevalidation: { ...current, [providerId]: { ...prev, enabled, intervalMinutes } },
        }),
      });
    } catch (error) {
      console.log("Error saving revalidation config:", error);
    }
  };

  const handleRevalidationToggle = () => {
    setRevalidation((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      saveRevalidationConfig(next);
      return next;
    });
  };

  const handleRevalidationIntervalChange = (value) => {
    const intervalMinutes = Number(value);
    setRevalidation((prev) => ({ ...prev, intervalMinutes }));
    if (revalidation.enabled) saveRevalidationConfig({ enabled: true, intervalMinutes });
  };
```

- [ ] **Step 4: Render controls after the Round Robin block**

Immediately after the Round Robin wrapper's closing `</div>` (the one at the same level as `<span ...>Round Robin</span>`, before the parent controls `</div>`), insert:

```jsx
              {/* Auto-revalidation: periodic credential + model check */}
              {connections.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-muted font-medium">Auto-revalidate</span>
                  <Toggle checked={revalidation.enabled} onChange={handleRevalidationToggle} />
                  {revalidation.enabled && (
                    <select
                      value={String(revalidation.intervalMinutes)}
                      onChange={(e) => handleRevalidationIntervalChange(e.target.value)}
                      title="Re-checks this provider's connections and models periodically (max 60min keeps health badges fresh)"
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
                    >
                      {[5, 10, 15, 30, 60].map((m) => (
                        <option key={m} value={m}>{`Every ${m} min`}</option>
                      ))}
                    </select>
                  )}
                  {revalidation.enabled && revalidation.lastRunAt && (
                    <span className="text-[10px] text-text-muted">
                      {`last: ${new Date(revalidation.lastRunAt).toLocaleTimeString()} · ${revalidation.lastStatus || "?"}`}
                    </span>
                  )}
                </div>
              )}
```

- [ ] **Step 5: Lint**

Run: `npx eslint "src/app/(dashboard)/dashboard/providers/[id]/page.js"`
Expected: no errors.

- [ ] **Step 6: Visual verification (browser)**

Run (from repo root): `hub start name=web application=npm args=[run,dev] ready={port:20127,timeout:120}` then open `http://localhost:20127/dashboard/providers/openai` in the browser (login with `INITIAL_PASSWORD` if prompted — default `123456`).
Expected: "Auto-revalidate" toggle renders next to "Round Robin" on any provider with connections; toggling on shows the interval select; selecting "Every 5 min" persists (reload keeps it).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/dashboard/providers/[id]/page.js"
git commit -m "feat(dashboard): per-provider auto-revalidate toggle and interval"
```

---

### Task 5: End-to-end verification + changelog

**Files:**
- Modify: `CHANGELOG.md` (follow the existing entry format at the top of the file)

**Interfaces:** none new.

- [ ] **Step 1: Run all tests touched by or adjacent to this feature**

Run: `cd tests && npx vitest run unit/provider-revalidation.test.js unit/model-health-revalidate.test.js unit/provider-test-models-routing.test.js unit/model-test-routing.test.js unit/model-health-sink.test.js unit/model-health-classifier.test.js unit/model-health-repo.test.js unit/model-health-tps.test.js unit/model-health-filter.test.js`
Expected: all PASS (these were green before except any catalogued in `tests/__baseline__/known-fails.txt` — none of these files are catalogued).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles with no errors.

- [ ] **Step 3: Runtime smoke (scheduler actually runs)**

With the dev server from Task 4 running, in the browser dashboard:
1. Toggle Auto-revalidate ON for a provider with no connections (e.g. one you remove connections from) → within one tick (60s) server console shows `[Revalidate] <provider>: error no active connections`.
2. `curl -s http://localhost:20127/api/settings | jq .providerRevalidation` → entry has `lastStatus: "error"` and `lastRunAt`.
3. Toggle OFF → console shows nothing new after the next tick; `configureProviderRevalidation` stopped the scheduler (`[Revalidate] scheduler stopped` only if it was the last enabled one).

- [ ] **Step 4: CHANGELOG entry**

Add an entry at the top following the file's existing format (version heading + bullet), e.g.:

```md
- feat: per-provider auto-revalidation worker — periodically re-checks connections and models (configurable 5–60 min in the provider page)
```

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): per-provider auto-revalidation worker"
```

---

## Self-Review (completed during planning)

1. **Spec coverage:** config key + clamp (Task 2), worker + tick + immediate-run (Task 2), credential gate + once-per-provider pings (Task 2), boot + live reconfig (Task 3), UI toggle/interval/readout (Task 4), extraction reuse (Task 1), tests + smoke (Tasks 1/2/5). Spec's "Limitations" (multi-process, settings write rate) are documented in the spec, not engineered — per spec.
2. **Placeholders:** none — every step carries complete code/commands.
3. **Type consistency:** `revalidateProviderModels(providerId, { connectionId })` used identically in route (Task 1) and service deps (Task 2); `testSingleConnection` success checked via `r.valid` (matches its actual return); `state` shape `{ interval, nextRunAt, running, runningTick }` identical in module and tests; settings key `providerRevalidation` identical everywhere.
