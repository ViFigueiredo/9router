// Global ranking builder shared by the /api/ranking route and the combo
// reordering endpoint, so both consume exactly one ranking implementation.
import { getModelHealth } from "@/lib/db/repos/modelHealthRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { classifyModel, isModelNotServed } from "./classifier.js";
import { rankEntries, sampleCount, RANKING_WEIGHTS } from "./ranking.js";

// combo membership: "provider/model" → [{ id, name, position }]
export function buildComboMembership(combos) {
  const membership = new Map();
  for (const combo of combos || []) {
    (combo.models || []).forEach((model, index) => {
      if (typeof model !== "string") return;
      if (!membership.has(model)) membership.set(model, []);
      membership.get(model).push({ id: combo.id, name: combo.name, position: index + 1 });
    });
  }
  return membership;
}

function aggregateProviders(models) {
  const byProvider = new Map();
  for (const entry of models) {
    if (!byProvider.has(entry.provider)) {
      byProvider.set(entry.provider, {
        provider: entry.provider, models: 0, ok: 0, fail: 0,
        weighted: 0, weight: 0, best: entry,
      });
    }
    const bucket = byProvider.get(entry.provider);
    bucket.models += 1;
    bucket.ok += entry.stats?.ok || 0;
    bucket.fail += entry.stats?.fail || 0;
    // Sample-weighted so a long track record is not dragged down by a single
    // untested custom model.
    const weight = Math.max(1, entry.rank.samples);
    bucket.weighted += entry.rank.score * weight;
    bucket.weight += weight;
    if (entry.rank.score > bucket.best.rank.score) bucket.best = entry;
  }

  return [...byProvider.values()]
    .map((bucket) => ({
      provider: bucket.provider,
      models: bucket.models,
      ok: bucket.ok,
      fail: bucket.fail,
      samples: bucket.ok + bucket.fail,
      successRate: bucket.ok + bucket.fail > 0
        ? Math.round((bucket.ok / (bucket.ok + bucket.fail)) * 1000) / 10
        : null,
      score: Math.round((bucket.weighted / bucket.weight) * 10) / 10,
      topModel: bucket.best.model,
      topModelScore: bucket.best.rank.score,
    }))
    .sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider));
}

/**
 * Rank every measured (optionally filtered) provider/model in one pass.
 * Returns the JSON-safe payload plus `scoreByModel` for in-process consumers.
 */
export async function buildGlobalRanking({ provider = "", kind = "", measuredOnly = true, nowMs = Date.now() } = {}) {
  const [health, combos] = await Promise.all([getModelHealth(), getCombos()]);
  const membership = buildComboMembership(combos);

  const entries = [];
  for (const [providerId, map] of Object.entries(health || {})) {
    if (provider && providerId !== provider) continue;
    for (const [model, mh] of Object.entries(map || {})) {
      const modelKind = mh?.kind || "llm";
      if (kind && modelKind !== kind) continue;
      if (measuredOnly && sampleCount(mh?.stats) === 0) continue;

      // Classify at read time: a stored tag can be stale once its fatal events
      // age out of the 1h window (same rule as sorter.js).
      const { tag } = classifyModel(map, model, modelKind, nowMs);
      const lastError = mh?.lastError || null;
      entries.push({
        provider: providerId,
        model,
        kind: modelKind,
        tag,
        notServed: lastError ? isModelNotServed({ status: lastError.status, message: lastError.message }) : false,
        stats: mh?.stats || null,
        lastPingAt: mh?.lastPing?.at ?? null,
        lastErrorAt: lastError?.at ?? null,
        lastErrorStatus: lastError?.status ?? null,
        lastErrorMessage: lastError?.message ?? null,
        combos: membership.get(`${providerId}/${model}`) || [],
      });
    }
  }

  const models = rankEntries(entries, { nowMs }).map((entry, index) => ({ ...entry, position: index + 1 }));
  const scoreByModel = new Map(models.map((entry) => [`${entry.provider}/${entry.model}`, entry.rank.score]));

  return {
    generatedAt: nowMs,
    weights: RANKING_WEIGHTS,
    measuredOnly,
    models,
    providers: aggregateProviders(models),
    scoreByModel,
  };
}
