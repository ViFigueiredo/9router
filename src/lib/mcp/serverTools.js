// 9Router MCP server tool registry. Each tool is a thin adapter over the same
// repos/helpers the dashboard uses, so the MCP surface can never drift from the
// app's behaviour.
//
// Safety: tools marked `admin: true` mutate configuration and are refused unless
// `settings.mcpAllowAdmin === true` (default false), so handing an agent an API
// key does not silently grant administrative control.
import { getProviderConnections, getProviderConnectionById, createProviderConnection, updateProviderConnection } from "@/lib/db/index.js";
import { getCombos, getComboById, getComboByName, updateCombo, deleteCombo } from "@/lib/db/repos/combosRepo.js";
import { getCustomModels } from "@/lib/db/index.js";
import { getDisabledModels, disableModels, enableModels } from "@/lib/disabledModelsDb";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { classifyModel, isModelNotServed } from "@/lib/modelHealth/classifier.js";
import { getHealthSnapshot } from "@/lib/modelHealth/sink.js";
import { getModelHealthByProvider } from "@/lib/db/repos/modelHealthRepo.js";
import { buildGlobalRanking } from "@/lib/modelHealth/globalRanking.js";
import { reorderComboModels, orderChanged } from "@/lib/modelHealth/comboOrder.js";
import { getComboOrdering, setComboOrdering } from "@/lib/comboOrdering.js";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { recordObservation } from "@/lib/modelHealth/sink.js";
import { getModelInfo } from "@/sse/services/model.js";
import { getUsageStats } from "@/lib/usageDb";
import { APP_CONFIG } from "@/shared/constants/config";

export const MCP_SERVER_NAME = "9router";
export const MCP_SERVER_VERSION = APP_CONFIG.version;

const USAGE_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function requireAdmin() {
  const settings = await getSettings();
  if (settings.mcpAllowAdmin !== true) {
    throw new Error(
      "Administrative tools are disabled. Enable \"Allow MCP admin tools\" in Dashboard → MCP.",
    );
  }
}

async function resolveCombo({ combo, comboId }) {
  if (comboId) return await getComboById(comboId);
  if (combo) return await getComboByName(combo);
  return null;
}

export const TOOLS = [
  {
    name: "list_providers",
    description: "List configured provider connections with status (id, provider, account, active, last error).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const connections = await getProviderConnections();
      return connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        name: c.name || c.email || null,
        authType: c.authType,
        isActive: c.isActive !== false,
        testStatus: c.testStatus || null,
        lastError: c.lastError || null,
      }));
    },
  },
  {
    name: "list_models",
    description: "List models of one provider (alias or id) with their kind and current health tag.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Provider alias or id, e.g. openai" },
        kind: { type: "string", description: "Filter by kind (llm, image, tts, stt, embedding, video)" },
      },
      required: ["provider"],
      additionalProperties: false,
    },
    handler: async ({ provider, kind }) => {
      const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
      const registry = getProviderModels(alias).map((m) => ({
        model: m.id || m.name,
        name: m.name || m.id,
        kind: m.kind || m.type || "llm",
      }));
      const custom = (await getCustomModels().catch(() => []))
        .filter((m) => m.providerAlias === provider)
        .map((m) => ({ model: m.id, name: m.name || m.id, kind: m.kind || m.type || "llm", custom: true }));
      const healthMap = await getModelHealthByProvider(provider).catch(() => ({}));
      const now = Date.now();
      return [...registry, ...custom]
        .filter((m) => !kind || m.kind === kind)
        .map((m) => {
          const mh = healthMap[m.model];
          const tag = mh ? classifyModel(healthMap, m.model, mh.kind || m.kind, now).tag : "unknown";
          return { ...m, tag, lastPingAt: mh?.lastPing?.at ?? null };
        });
    },
  },
  {
    name: "get_model_health",
    description: "Per-model health detail for a provider: tag, latency, tok/s, events, last error, not-served flag.",
    inputSchema: {
      type: "object",
      properties: { provider: { type: "string" } },
      required: ["provider"],
      additionalProperties: false,
    },
    handler: async ({ provider }) => {
      const snapshot = await getHealthSnapshot(provider);
      const entries = Object.entries(snapshot).map(([model, h]) => ({
        model,
        tag: h.tag,
        kind: h.kind,
        ttftAvgMs: h.ttftAvgMs,
        tpsAvg: h.tpsAvg,
        totalEvents: h.totalEvents,
        fatalEvents: h.fatalEvents,
        lastPingAt: h.lastPingAt,
        notServed: h.notServed,
        lastErrorStatus: h.lastErrorStatus,
        lastErrorMessage: h.lastErrorMessage,
      }));
      return entries.sort((a, b) => String(a.model).localeCompare(String(b.model)));
    },
  },
  {
    name: "get_ranking",
    description: "Global provider/model ranking built from accumulated validate counters (reliability 60%, speed 30%, recency 10%).",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        kind: { type: "string" },
        limit: { type: "number", description: "Max models to return (default 25)" },
        measuredOnly: { type: "boolean", description: "Only models with samples (default true)" },
      },
      additionalProperties: false,
    },
    handler: async ({ provider = "", kind = "", limit = 25, measuredOnly = true }) => {
      const { models, providers } = await buildGlobalRanking({ provider, kind, measuredOnly });
      return {
        providers,
        models: models.slice(0, Math.max(1, Math.min(Number(limit) || 25, 200))).map((m) => ({
          position: m.position,
          provider: m.provider,
          model: m.model,
          kind: m.kind,
          tag: m.tag,
          score: m.rank.score,
          samples: m.rank.samples,
          combos: m.combos.map((c) => `${c.name}#${c.position}`),
        })),
      };
    },
  },
  {
    name: "list_combos",
    description: "List combos with their models, execution strategy, position locks and auto-reorder flag.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const combos = await getCombos();
      const out = [];
      for (const combo of combos) {
        const ordering = await getComboOrdering(combo.name).catch(() => ({ lockedModels: [], autoReorder: false }));
        out.push({
          id: combo.id,
          name: combo.name,
          kind: combo.kind || "llm",
          models: combo.models || [],
          lockedModels: ordering.lockedModels,
          autoReorder: ordering.autoReorder,
        });
      }
      return out;
    },
  },
  {
    name: "get_usage_stats",
    description: "Token/request usage summary for a period (today, 24h, 7d, 30d, 60d, all).",
    inputSchema: {
      type: "object",
      properties: { period: { type: "string", enum: [...USAGE_PERIODS] } },
      additionalProperties: false,
    },
    handler: async ({ period = "7d" }) => {
      if (!USAGE_PERIODS.has(period)) throw new Error(`Invalid period "${period}"`);
      return await getUsageStats(period);
    },
  },
  {
    name: "test_model",
    description: "Ping one model through the gateway (kind-routed) and record the outcome in model health. Costs one upstream request.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Full model string, e.g. openai/gpt-5.4" },
        kind: { type: "string", description: "llm (default), image, tts, stt, embedding" },
      },
      required: ["model"],
      additionalProperties: false,
    },
    handler: async ({ model, kind = "llm" }) => {
      const result = await pingModelByKind(model, kind);
      const info = await getModelInfo(model).catch(() => null);
      if (!result.skipped) {
        await recordObservation({
          provider: info?.provider || "unknown",
          model: info?.model || model,
          kind,
          ok: !!result.ok,
          status: result.status ?? null,
          ttftMs: typeof result.latencyMs === "number" ? result.latencyMs : null,
          tps: typeof result.tps === "number" ? result.tps : null,
          isPing: true,
          errorText: result.error || "",
          ...(/timeout|aborted/i.test(String(result.error || "")) ? { fatalOverride: false } : {}),
        });
      }
      return {
        ok: !!result.ok,
        skipped: !!result.skipped,
        status: result.status ?? null,
        latencyMs: result.latencyMs ?? null,
        tps: result.tps ?? null,
        error: result.error || null,
      };
    },
  },
  {
    name: "reorder_combo",
    description: "Reclassify a combo's fallback order by the global ranking, keeping position-locked models at their index.",
    inputSchema: {
      type: "object",
      properties: {
        combo: { type: "string", description: "Combo name" },
        comboId: { type: "string", description: "Combo id (alternative to name)" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const combo = await resolveCombo(args || {});
      if (!combo) throw new Error("Combo not found");
      const models = Array.isArray(combo.models) ? combo.models : [];
      const ordering = await getComboOrdering(combo.name);
      const { scoreByModel } = await buildGlobalRanking({ measuredOnly: true });
      const reordered = reorderComboModels(models, { locked: ordering.lockedModels, scoreByModel, unscoredScore: -1 });
      const changed = orderChanged(models, reordered);
      if (changed) await updateCombo(combo.id, { models: reordered });
      return { combo: combo.name, changed, models: reordered, lockedModels: ordering.lockedModels };
    },
  },
  {
    name: "set_models_enabled",
    description: "Enable or disable specific models of a provider (admin).",
    admin: true,
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Provider alias or id" },
        models: { type: "array", items: { type: "string" } },
        enabled: { type: "boolean" },
      },
      required: ["provider", "models", "enabled"],
      additionalProperties: false,
    },
    handler: async ({ provider, models, enabled }) => {
      await requireAdmin();
      if (!Array.isArray(models) || models.length === 0) throw new Error("models must be a non-empty array");
      const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
      if (enabled) await enableModels(alias, models);
      else await disableModels(alias, models);
      const disabled = await getDisabledModels();
      return { provider: alias, enabled, disabled: disabled[alias] || [] };
    },
  },
  {
    name: "set_connection_active",
    description: "Activate or deactivate a provider connection (admin).",
    admin: true,
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        isActive: { type: "boolean" },
      },
      required: ["connectionId", "isActive"],
      additionalProperties: false,
    },
    handler: async ({ connectionId, isActive }) => {
      await requireAdmin();
      const existing = await getProviderConnectionById(connectionId);
      if (!existing) throw new Error("Connection not found");
      const updated = await updateProviderConnection(connectionId, { isActive: isActive !== false });
      return { id: updated?.id || connectionId, provider: updated?.provider || existing.provider, isActive: updated?.isActive !== false };
    },
  },
  {
    name: "add_connection",
    description: "Add an API-key connection for a provider (admin).",
    admin: true,
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Provider id, e.g. openai" },
        apiKey: { type: "string" },
        name: { type: "string" },
      },
      required: ["provider", "apiKey"],
      additionalProperties: false,
    },
    handler: async ({ provider, apiKey, name }) => {
      await requireAdmin();
      if (!provider || !apiKey) throw new Error("provider and apiKey are required");
      const created = await createProviderConnection({
        provider,
        authType: "apikey",
        name: name || null,
        apiKey,
        isActive: true,
      });
      return { id: created?.id, provider: created?.provider || provider, name: created?.name || null };
    },
  },
  {
    name: "delete_combo",
    description: "Delete a combo by name or id (admin).",
    admin: true,
    inputSchema: {
      type: "object",
      properties: {
        combo: { type: "string" },
        comboId: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      await requireAdmin();
      const combo = await resolveCombo(args || {});
      if (!combo) throw new Error("Combo not found");
      const ok = await deleteCombo(combo.id);
      await setComboOrdering(combo.name, { lockedModels: [], autoReorder: false }).catch(() => {});
      return { combo: combo.name, deleted: !!ok };
    },
  },
];

export function listToolDefinitions() {
  return TOOLS.map(({ name, description, inputSchema, admin }) => ({
    name,
    description: admin ? `${description} [requires MCP admin tools enabled]` : description,
    inputSchema,
  }));
}

export async function callTool(name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`Unknown tool: ${name}`);
  try {
    const result = await tool.handler(args || {});
    return text(result);
  } catch (error) {
    return fail(`${tool.name} failed: ${error?.message || error}`);
  }
}
