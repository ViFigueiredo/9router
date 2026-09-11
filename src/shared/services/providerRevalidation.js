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
    // credentials down → skip model pings entirely (no tokens spent on a broken
    // account).
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
    const failed = (out.results || []).filter((r) => !r.ok && !r.skipped).length;
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
