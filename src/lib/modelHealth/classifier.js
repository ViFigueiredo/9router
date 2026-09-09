// Pure model-health rules. No DB, no imports from src — unit-testable in isolation.
// Window semantics: 1h sliding; nothing expires hard, absence of data = unknown.

export const HEALTH_THRESHOLDS = {
  windowMs: 60 * 60 * 1000, // 1h sliding window
  fatalThreshold: 2,        // ≥2 fatal model-level events in window → failing
  slowMultiplier: 2,        // > 2x provider p50 (successful TTFT)
  slowFloorMs: 15_000,      // ...and above this absolute floor
  maxEvents: 500,
};

export const HEALTH_TAGS = {
  OK: "ok",
  SLOW: "slow",
  FAILING: "failing",
  UNKNOWN: "unknown",
};

// Model-level fatal vs account-level. Auth/quota/rate (401/403/429) are handled
// by connection locks + backoff and must NOT mark the model failing.
export function isFatalEvent({ ok, status }) {
  if (ok) return false;
  if (status === null || status === undefined) return true;
  if (status === 404 || status === 408 || status === 499) return true;
  if (status >= 500) return true;
  return false;
}

export function pruneEvents(events, now, windowMs = HEALTH_THRESHOLDS.windowMs) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const cutoff = now - windowMs;
  let out = events.filter((e) => e && e.ts >= cutoff);
  if (out.length > HEALTH_THRESHOLDS.maxEvents) {
    out = out.slice(out.length - HEALTH_THRESHOLDS.maxEvents);
  }
  return out;
}

// Mean successful TTFT across all models of one provider+kind, within the window.
export function providerP50(providerMap, kind, now, windowMs = HEALTH_THRESHOLDS.windowMs) {
  if (!providerMap || typeof providerMap !== "object") return null;
  let sum = 0;
  let count = 0;
  for (const modelHealth of Object.values(providerMap)) {
    if (!modelHealth || (kind && modelHealth.kind !== kind)) continue;
    for (const e of pruneEvents(modelHealth.events || [], now, windowMs)) {
      if (e.ok && typeof e.ttftMs === "number") {
        sum += e.ttftMs;
        count += 1;
      }
    }
  }
  return count > 0 ? sum / count : null;
}

// Provider-average helper for per-model classification using the whole map.
export function classifyModel(providerMap, modelId, kind, now, thresholds = HEALTH_THRESHOLDS) {
  const mh = providerMap && providerMap[modelId];
  if (!mh) return { tag: HEALTH_TAGS.UNKNOWN, reason: "no data" };
  const p50 = providerP50(providerMap, kind || mh.kind, now, thresholds.windowMs);
  return classify({
    events: mh.events || [],
    lastPing: mh.lastPing || null,
    providerP50Ms: p50,
    now,
    thresholds,
  });
}

export function classify({ events, lastPing, providerP50Ms, now, thresholds = HEALTH_THRESHOLDS }) {
  const win = pruneEvents(events || [], now, thresholds.windowMs);
  const fatalCount = win.filter((e) => e.fatal).length;

  const pingFresh = lastPing && typeof lastPing.at === "number" && lastPing.at >= now - thresholds.windowMs;

  if (fatalCount >= thresholds.fatalThreshold || (pingFresh && !lastPing.ok)) {
    return { tag: HEALTH_TAGS.FAILING, reason: `${fatalCount} fatal error(s) in window` };
  }

  const ttftSamples = win.filter((e) => e.ok && typeof e.ttftMs === "number");
  if (ttftSamples.length > 0 && providerP50Ms != null) {
    const modelP50 = ttftSamples.reduce((s, e) => s + e.ttftMs, 0) / ttftSamples.length;
    if (modelP50 > providerP50Ms * thresholds.slowMultiplier && modelP50 > thresholds.slowFloorMs) {
      return { tag: HEALTH_TAGS.SLOW, reason: `ttft ${Math.round(modelP50)}ms > 2x provider p50 ${Math.round(providerP50Ms)}ms` };
    }
  }

  if (win.length > 0 || pingFresh) {
    return { tag: HEALTH_TAGS.OK, reason: "healthy within window" };
  }
  return { tag: HEALTH_TAGS.UNKNOWN, reason: "no recent data" };
}
