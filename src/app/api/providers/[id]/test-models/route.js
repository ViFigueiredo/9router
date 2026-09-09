import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { recordObservation, getHealthSnapshot } from "@/lib/modelHealth/sink.js";
import { getModelInfo } from "@/sse/services/model.js";

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
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;

    let models = getProviderModels(alias);

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    // Compatible providers: fetch live model list
    if (isCompatible && models.length === 0) {
      try {
        const modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models`);
        if (modelsRes.ok) {
          const data = await modelsRes.json();
          models = (data.models || []).map((m) => ({ id: m.id || m.name, name: m.name || m.id }));
        }
      } catch { /* fallback to empty */ }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    // Warm up with first model to trigger token refresh (if needed) before parallel calls.
    // This prevents race condition where multiple requests concurrently refresh the same token.
    const [first, ...rest] = models;
    const firstKind = first.kind || first.type || "llm";
    const firstResult = await pingModelByKind(`${alias}/${first.id}`, firstKind, baseUrl);
    const results = [{ modelId: first.id, name: first.name || first.id, kind: first.kind || first.type || "llm", ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model) => {
          const result = await pingModelByKind(`${alias}/${model.id}`, model.kind || model.type || "llm", baseUrl);
          return { modelId: model.id, name: model.name || model.id, kind: model.kind || model.type || "llm", ...result };
        })
      );
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
          isPing: true,
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

    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.log("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
