// Global ranking score for provider/model health. Pure: no DB, no window logic —
// the caller resolves `tag`/`notServed` at read time and passes accumulated
// `stats`, so this module is unit-testable in isolation (same contract as
// classifier.js).
import { HEALTH_TAGS } from "./classifier.js";

export const RANKING_WEIGHTS = {
  reliability: 0.6,
  speed: 0.3,
  recency: 0.1,
};

export const RANKING_THRESHOLDS = {
  // Below this many samples the reliability component is neutral: a single lucky
  // ping must not outrank a model with a long, real track record.
  minSamples: 3,
  recencyHalfLifeMs: 24 * 60 * 60 * 1000,
  // Within the speed component, TTFT (perceived latency) weighs more than TPS.
  speedTtftWeight: 0.6,
  speedTpsWeight: 0.4,
};

const NEUTRAL = 0.5;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function statsOf(entry) {
  return entry?.stats || null;
}

export function sampleCount(stats) {
  return (stats?.ok || 0) + (stats?.fail || 0);
}

export function avgTtftMs(stats) {
  return stats && stats.ttftCount > 0 ? stats.ttftSumMs / stats.ttftCount : null;
}

export function avgTps(stats) {
  return stats && stats.tpsCount > 0 ? stats.tpsSum / stats.tpsCount : null;
}

export function reliabilityScore(stats, thresholds = RANKING_THRESHOLDS) {
  const ok = stats?.ok || 0;
  const fail = stats?.fail || 0;
  const total = ok + fail;
  if (total < thresholds.minSamples) return NEUTRAL;
  return clamp01(ok / total);
}

export function recencyScore(lastOkAt, nowMs, thresholds = RANKING_THRESHOLDS) {
  if (!lastOkAt || !Number.isFinite(lastOkAt)) return NEUTRAL;
  const age = Math.max(0, nowMs - lastOkAt);
  return clamp01(Math.pow(0.5, age / thresholds.recencyHalfLifeMs));
}

function bounds(values) {
  const present = values.filter((v) => v != null && Number.isFinite(v));
  if (present.length < 2) return null;
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (max === min) return null; // no spread: speed is undecidable, stay neutral
  return { min, max };
}

function normalize(value, b) {
  return clamp01((value - b.min) / (b.max - b.min));
}

// `cohort` = entries of the same kind; TTFT/TPS are only comparable inside a kind.
export function speedScore(entry, cohort, thresholds = RANKING_THRESHOLDS) {
  const stats = statsOf(entry);
  const ttft = avgTtftMs(stats);
  const tps = avgTps(stats);

  const ttftBounds = bounds((cohort || []).map((e) => avgTtftMs(statsOf(e))));
  const tpsBounds = bounds((cohort || []).map((e) => avgTps(statsOf(e))));

  const parts = [];
  if (ttft != null && ttftBounds) parts.push({ w: thresholds.speedTtftWeight, v: 1 - normalize(ttft, ttftBounds) });
  if (tps != null && tpsBounds) parts.push({ w: thresholds.speedTpsWeight, v: normalize(tps, tpsBounds) });
  if (parts.length === 0) return NEUTRAL;

  const totalWeight = parts.reduce((sum, p) => sum + p.w, 0);
  return clamp01(parts.reduce((sum, p) => sum + p.v * p.w, 0) / totalWeight);
}

export function scoreEntry(entry, cohort, nowMs = Date.now(), weights = RANKING_WEIGHTS, thresholds = RANKING_THRESHOLDS) {
  const stats = statsOf(entry);
  const reliability = reliabilityScore(stats, thresholds);
  const speed = speedScore(entry, cohort, thresholds);
  const recency = recencyScore(stats?.lastOkAt, nowMs, thresholds);
  const score = 100 * (
    weights.reliability * reliability
    + weights.speed * speed
    + weights.recency * recency
  );
  return {
    score: Math.round(score * 10) / 10,
    reliability: Math.round(reliability * 1000) / 1000,
    speed: Math.round(speed * 1000) / 1000,
    recency: Math.round(recency * 1000) / 1000,
    samples: sampleCount(stats),
    // Failing (in-window fatal events) or not served upstream: always at the tail,
    // whatever the score says.
    deprioritized: entry?.tag === HEALTH_TAGS.FAILING || entry?.notServed === true,
  };
}

/**
 * Rank entries of mixed providers/kinds. Entries are grouped by `kind` for speed
 * normalization, then sorted: deprioritized last, then score desc, then a stable
 * provider/model tiebreak.
 */
export function rankEntries(entries, { nowMs = Date.now(), weights = RANKING_WEIGHTS, thresholds = RANKING_THRESHOLDS } = {}) {
  const cohorts = new Map();
  for (const entry of entries) {
    const kind = entry.kind || "llm";
    if (!cohorts.has(kind)) cohorts.set(kind, []);
    cohorts.get(kind).push(entry);
  }

  return entries
    .map((entry) => ({ ...entry, rank: scoreEntry(entry, cohorts.get(entry.kind || "llm") || [], nowMs, weights, thresholds) }))
    .sort((a, b) => (
      Number(a.rank.deprioritized) - Number(b.rank.deprioritized)
      || b.rank.score - a.rank.score
      || String(a.provider).localeCompare(String(b.provider))
      || String(a.model).localeCompare(String(b.model))
    ));
}
