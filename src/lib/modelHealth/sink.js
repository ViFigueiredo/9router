import {
  getModelHealthByProvider, updateModelHealth,
} from "@/lib/db/repos/modelHealthRepo.js";
import {
  HEALTH_TAGS, isFatalEvent, pruneEvents, classifyModel, HEALTH_THRESHOLDS,
} from "./classifier.js";

// Fail-open: never throw. Persistence is fire-and-forget — firing and
// forgetting is fine, and awaiting is equally safe: every error path swallows.

function nowMs() {
  return Date.now();
}

export async function recordObservation({ provider, model, kind = "llm", ok, status = null, ttftMs = null, totalMs = null, isPing = false, fatalOverride = undefined }) {
  try {
    if (!provider || !model) return;
    const ts = nowMs();
    // fatalOverride lets a probe report an inconclusive outcome (e.g. the batch
    // ping hit its own timeout under load) without poisoning the model's tag.
    const fatal = typeof fatalOverride === "boolean" ? fatalOverride : isFatalEvent({ ok, status });
    const pingTtft = isPing ? (ttftMs ?? totalMs ?? null) : ttftMs;

    await updateModelHealth(provider, model, (prev) => {
      const base = prev || { kind, events: [], lastPing: null, tag: HEALTH_TAGS.UNKNOWN, tagComputedAt: null };
      const events = pruneEvents(base.events || [], ts, HEALTH_THRESHOLDS.windowMs);
      // Only ok events and fatal failures are model-health signals. Non-fatal
      // failures (401/403/429, request-shape 400s) are account/connection or
      // request concerns — recording them consumes maxEvents slots and their
      // mere presence would classify a lone 429/401 as "ok" window activity.
      if (ok || fatal) {
        events.push({ ts, ok: !!ok, ttftMs: pingTtft ?? ttftMs, fatal });
      }
      // Persist lastPing only for pings whose outcome is meaningful for model
      // health: success (ok) or a model-fatal failure. Account-level failures
      // (401/403/429, isFatalEvent=false) keep the previous lastPing so they
      // never tag the model failing.
      const lastPing = isPing && (ok || fatal) ? { at: ts, ok: !!ok, latencyMs: pingTtft } : (base.lastPing || null);
      return { ...base, kind, events, lastPing };
    });

    // Recompute the provider-wide snapshot only for this provider (cheap: one kv row).
    await recomputeProvider(provider, kind);
  } catch {
    // swallow — telemetry loss must never fail a request
  }
}

async function recomputeProvider(provider, kind) {
  try {
    const map = await getModelHealthByProvider(provider);
    for (const modelId of Object.keys(map)) {
      const { tag } = classifyModel(map, modelId, kind, nowMs());
      if (tag !== map[modelId].tag) {
        await updateModelHealth(provider, modelId, (prev) =>
          prev ? { ...prev, tag, tagComputedAt: nowMs() } : prev);
      }
    }
  } catch {
    // swallow
  }
}

export async function getHealthSnapshot(provider) {
  try {
    const map = await getModelHealthByProvider(provider);
    const out = {};
    const ts = nowMs();
    for (const [modelId, mh] of Object.entries(map)) {
      const events = pruneEvents(mh.events || [], ts, HEALTH_THRESHOLDS.windowMs);
      const ttftSamples = events.filter((e) => e.ok && typeof e.ttftMs === "number");
      const { tag } = classifyModel(map, modelId, mh.kind, ts);
      out[modelId] = {
        tag,
        kind: mh.kind,
        ttftAvgMs: ttftSamples.length > 0
          ? Math.round(ttftSamples.reduce((s, e) => s + e.ttftMs, 0) / ttftSamples.length)
          : null,
        totalEvents: events.length,
        fatalEvents: events.filter((e) => e.fatal).length,
        lastPingAt: mh.lastPing?.at ?? null,
        updatedAt: mh.tagComputedAt ?? null,
      };
    }
    return out;
  } catch {
    return {};
  }
}
