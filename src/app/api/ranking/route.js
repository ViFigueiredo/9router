import { NextResponse } from "next/server";
import { getModelHealth } from "@/lib/db/repos/modelHealthRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { classifyModel, isModelNotServed } from "@/lib/modelHealth/classifier.js";
import { rankEntries, sampleCount, RANKING_WEIGHTS } from "@/lib/modelHealth/ranking.js";

export const dynamic = "force-dynamic";

function hasSamples(stats) {
  return sampleCount(stats) > 0;
}

// combo membership: "provider/model" → [{ id, name, position }]
function buildComboMembership(combos) {
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
      byProvider.set(entry.provider, { provider: entry.provider, models: 0, ok: 0, fail: 0, weighted: 0, weight: 0, best: entry });
    }
    const bucket = byProvider.get(entry.provider);
    bucket.models += 1;
    bucket.ok += entry.stats?.ok || 0;
    bucket.fail += entry.stats?.fail || 0;
    // Sample-weighted so a provider with a long track record is not dragged by a
    // single untested custom model.
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
      successRate: bucket.ok + bucket.fail > 0 ? Math.round((bucket.ok / (bucket.ok + bucket.fail)) * 1000) / 10 : null,
      score: Math.round((bucket.weighted / bucket.weight) * 10) / 10,
      topModel: bucket.best.model,
      topModelScore: bucket.best.rank.score,
    }))
    .sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider));
}

// GET /api/ranking?provider=&kind=&measuredOnly= → global provider/model ranking
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerFilter = searchParams.get("provider") || "";
    const kindFilter = searchParams.get("kind") || "";
    const measuredOnly = searchParams.get("measuredOnly") !== "false";

    const [health, combos] = await Promise.all([getModelHealth(), getCombos()]);
    const membership = buildComboMembership(combos);
    const now = Date.now();

    const entries = [];
    for (const [provider, map] of Object.entries(health || {})) {
      if (providerFilter && provider !== providerFilter) continue;
      for (const [model, mh] of Object.entries(map || {})) {
        const kind = mh?.kind || "llm";
        if (kindFilter && kind !== kindFilter) continue;
        if (measuredOnly && !hasSamples(mh?.stats)) continue;

        // Classify at read time: a stored tag can be stale once its fatal events
        // age out of the 1h window (same rule as sorter.js).
        const { tag } = classifyModel(map, model, kind, now);
        const lastError = mh?.lastError || null;
        entries.push({
          provider,
          model,
          kind,
          tag,
          notServed: lastError ? isModelNotServed({ status: lastError.status, message: lastError.message }) : false,
          stats: mh?.stats || null,
          lastPingAt: mh?.lastPing?.at ?? null,
          lastErrorAt: lastError?.at ?? null,
          lastErrorStatus: lastError?.status ?? null,
          lastErrorMessage: lastError?.message ?? null,
          combos: membership.get(`${provider}/${model}`) || [],
        });
      }
    }

    const rankedModels = rankEntries(entries, { nowMs: now }).map((entry, index) => ({ ...entry, position: index + 1 }));

    return NextResponse.json({
      generatedAt: now,
      weights: RANKING_WEIGHTS,
      measuredOnly,
      models: rankedModels,
      providers: aggregateProviders(rankedModels),
    });
  } catch (error) {
    console.log("Error building ranking:", error);
    return NextResponse.json({ error: "Failed to build ranking" }, { status: 500 });
  }
}
