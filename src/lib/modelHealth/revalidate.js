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
    // Bounded concurrency: an unbounded Promise.all saturates slow upstreams
    // and the batch then times out on models that pass when tested alone.
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
