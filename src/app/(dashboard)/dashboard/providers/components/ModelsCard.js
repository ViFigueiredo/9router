"use client";

import { useState, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Modal, ConfirmModal, AddToComboModal, ModelListBulkActionsBar } from "@/shared/components";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ModelHealthBadge from "@/shared/components/ModelHealthBadge";
import ComboMembershipChips from "@/shared/components/ComboMembershipChips";
import ModelListFilterBar from "@/shared/components/ModelListFilterBar";
import { filterModelRows, HEALTH_FILTER_ALL } from "@/shared/utils/modelHealthFilter";

// ── ModelRow ───────────────────────────────────────────────────
export function ModelRow({ model, fullModel, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, health, isSelected, onToggleSelect }) {
  const borderColor = isSelected
    ? "border-primary/60 bg-primary/5"
    : testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";
  const iconColor = testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  return (
    <div className={`group px-3 py-2 rounded-lg border ${borderColor} hover:bg-sidebar/50 transition-colors`}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!isSelected}
          onChange={onToggleSelect}
          aria-label={`Select model ${model.id}`}
          className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer shrink-0"
        />
        <span className="material-symbols-outlined text-base" style={iconColor ? { color: iconColor } : undefined}>
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
            <ModelHealthBadge health={health} />
            <ComboMembershipChips fullModel={fullModel} />
          </div>
          {model.name && <span className="text-[9px] text-text-muted/70 italic pl-1">{model.name}</span>}
        </div>
        {onTest && (
          <div className="relative group/btn">
            <button onClick={onTest} disabled={isTesting} className={`p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-opacity ${isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative group/btn">
          <button onClick={() => onCopy(fullModel, `model-${model.id}`)} className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary">
            <span className="material-symbols-outlined text-sm">{copied === `model-${model.id}` ? "check" : "content_copy"}</span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isFree && <span className="text-[10px] font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">FREE</span>}
        {isCustom && (
          <button onClick={onDeleteAlias} className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" title="Remove custom model">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({ id: PropTypes.string.isRequired }).isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  health: PropTypes.shape({ tag: PropTypes.string }),
};

// ── AddCustomModelModal ────────────────────────────────────────
function AddCustomModelModal({ isOpen, onSave, onClose }) {
  const [modelId, setModelId] = useState("");

  const handleSave = () => {
    if (!modelId.trim()) return;
    onSave(modelId.trim());
    setModelId("");
  };

  return (
    <Modal isOpen={isOpen} title="Add Custom Model" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. tts-1-hd"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth disabled={!modelId.trim()}>Add</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── ModelsCard ─────────────────────────────────────────────────
// Self-contained card: shows models for a provider, filtered by optional `kindFilter`.
// kindFilter: if provided, only shows models with matching type/kinds field.
export default function ModelsCard({ providerId, kindFilter, providerAliasOverride }) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModelId, setTestingModelId] = useState(null);
  const [testError, setTestError] = useState("");
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [healthByModel, setHealthByModel] = useState({});
  const [filterQuery, setFilterQuery] = useState("");
  const [filterTag, setFilterTag] = useState(HEALTH_FILTER_ALL);
  const [selectedModelIds, setSelectedModelIds] = useState(() => new Set());
  const [showAddToCombo, setShowAddToCombo] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [bulkTesting, setBulkTesting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const providerAlias = providerAliasOverride || getProviderAlias(providerId);
  const effectiveType = kindFilter || "llm";

  const fetchData = async () => {
    try {
      const [aliasRes, customRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/models/custom", { cache: "no-store" }),
      ]);
      const aliasData = await aliasRes.json();
      const customData = await customRes.json();
      if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
      if (customRes.ok) setCustomModels(customData.models || []);
    } catch (e) { console.log("ModelsCard fetch error:", e); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aliasRes, customRes] = await Promise.all([
          fetch("/api/models/alias"),
          fetch("/api/models/custom", { cache: "no-store" }),
        ]);
        const aliasData = await aliasRes.json();
        const customData = await customRes.json();
        if (!cancelled) {
          if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
          if (customRes.ok) setCustomModels(customData.models || []);
        }
      } catch (e) { console.log("ModelsCard fetch error:", e); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/model-health?provider=${encodeURIComponent(providerAlias)}`);
        const data = await res.json();
        if (!cancelled && data.health) setHealthByModel(data.health);
      } catch { /* badge stays unknown */ }
    })();
    return () => { cancelled = true; };
  }, [providerAlias]);

  const handleSetAlias = async (modelId, alias) => {
    const fullModel = `${providerAlias}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) await fetchData();
    } catch (e) { console.log("set alias error:", e); }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      if (res.ok) await fetchData();
    } catch (e) { console.log("delete alias error:", e); }
  };

  const handleAddCustomModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, id: modelId, type: effectiveType }),
      });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("add custom model error:", e); }
  };

  const handleDeleteCustomModel = async (modelId) => {
    try {
      const params = new URLSearchParams({ providerAlias, id: modelId, type: effectiveType });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("delete custom model error:", e); }
  };

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setTestError("Network error");
    } finally { setTestingModelId(null); }
  };

  // Built-in models — filter by kindFilter if provided
  const allBuiltIn = getModelsByProviderId(providerId);
  const builtInModels = kindFilter
    ? allBuiltIn.filter((m) => {
        if (m.kinds) return m.kinds.includes(kindFilter);
        return getModelKind(m, "llm") === kindFilter;
      })
    : allBuiltIn;

  // Custom models for this provider + kind, dedupe vs built-in
  const myCustomModels = customModels.filter(
    (m) => m.providerAlias === providerAlias
      && getModelKind(m, "llm") === effectiveType
      && !builtInModels.some((b) => b.id === m.id)
  );

  const displayModels = filterModelRows(builtInModels, { query: filterQuery, tag: filterTag, healthByModel });
  const visibleCustomModels = filterModelRows(myCustomModels, { query: filterQuery, tag: filterTag, healthByModel });
  const totalModels = builtInModels.length + myCustomModels.length;
  const shownModels = displayModels.length + visibleCustomModels.length;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Models{kindFilter ? ` — ${kindFilter.toUpperCase()}` : ""}</h2>
        </div>
        {testError && <p className="text-xs text-red-500 mb-3 break-words">{testError}</p>}

        {feedback && (
          <p className={`text-xs mb-3 ${feedback.type === "error" ? "text-red-500" : "text-green-500"}`} role="status">
            {feedback.text}
          </p>
        )}

        {totalModels > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            <ModelListFilterBar
              query={filterQuery}
              onQueryChange={setFilterQuery}
              tag={filterTag}
              onTagChange={setFilterTag}
              shown={shownModels}
              total={totalModels}
              allSelected={shownModels > 0 && [...displayModels, ...visibleCustomModels].every((m) => selectedModelIds.has(m.id))}
              onToggleSelectAll={() => {
                const allVisible = [...displayModels, ...visibleCustomModels];
                const allSelected = shownModels > 0 && allVisible.every((m) => selectedModelIds.has(m.id));
                setSelectedModelIds((prev) => {
                  const next = new Set(prev);
                  for (const m of allVisible) {
                    if (allSelected) next.delete(m.id);
                    else next.add(m.id);
                  }
                  return next;
                });
              }}
            />
            <ModelListBulkActionsBar
              selectedCount={selectedModelIds.size}
              allSelected={shownModels > 0 && [...displayModels, ...visibleCustomModels].every((m) => selectedModelIds.has(m.id))}
              onToggleSelectAll={() => {
                const allVisible = [...displayModels, ...visibleCustomModels];
                const allSelected = shownModels > 0 && allVisible.every((m) => selectedModelIds.has(m.id));
                setSelectedModelIds((prev) => {
                  const next = new Set(prev);
                  for (const m of allVisible) {
                    if (allSelected) next.delete(m.id);
                    else next.add(m.id);
                  }
                  return next;
                });
              }}
              onClearSelection={() => setSelectedModelIds(new Set())}
              onTestSelected={async () => {
                if (bulkTesting || selectedModelIds.size === 0) return;
                setBulkTesting(true);
                setFeedback(null);
                const ids = Array.from(selectedModelIds);
                let okCount = 0;
                for (const mid of ids) {
                  setTestingModelId(mid);
                  try {
                    const res = await fetch("/api/models/test", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ model: `${providerAlias}/${mid}`, kind: kindFilter }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (data.ok) okCount++;
                    setModelTestResults((prev) => ({ ...prev, [mid]: data.ok ? "ok" : "error" }));
                  } catch {
                    setModelTestResults((prev) => ({ ...prev, [mid]: "error" }));
                  }
                }
                setTestingModelId(null);
                setBulkTesting(false);
                setFeedback({
                  type: okCount === ids.length ? "success" : "error",
                  text: `Tested ${ids.length} model${ids.length === 1 ? "" : "s"} — ${okCount} ok, ${ids.length - okCount} failed.`,
                });
              }}
              isTesting={bulkTesting}
              onAddToCombo={() => setShowAddToCombo(true)}
              onDeleteSelected={() => setShowConfirmDelete(true)}
              deleteDisabled={!Array.from(selectedModelIds).some((id) => myCustomModels.some((m) => m.id === id) || modelAliases[id])}
            />
          </div>
        )}

        {totalModels > 0 && shownModels === 0 && (
          <p className="text-xs text-text-muted mb-3">No models match this filter.</p>
        )}

        <div className="flex flex-wrap gap-3">
          {displayModels.map((model) => {
            const fullModel = `${providerAlias}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel)?.[0];
            return (
              <ModelRow
                key={model.id}
                model={model}
                fullModel={`${providerAlias}/${model.id}`}
                alias={existingAlias}
                copied={copied}
                onCopy={copy}
                onSetAlias={(alias) => handleSetAlias(model.id, alias)}
                onDeleteAlias={() => handleDeleteAlias(existingAlias)}
                testStatus={modelTestResults[model.id]}
                onTest={() => handleTestModel(model.id)}
                isTesting={testingModelId === model.id}
                isFree={model.isFree}
                health={healthByModel[model.id]}
                isSelected={selectedModelIds.has(model.id)}
                onToggleSelect={() => {
                  setSelectedModelIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(model.id)) next.delete(model.id);
                    else next.add(model.id);
                    return next;
                  });
                }}
              />
            );
          })}

          {visibleCustomModels.map((model) => (
            <ModelRow
              key={`${model.id}-${model.type}`}
              model={{ id: model.id, name: model.name }}
              fullModel={`${providerAlias}/${model.id}`}
              copied={copied}
              onCopy={copy}
              onSetAlias={() => {}}
              onDeleteAlias={() => handleDeleteCustomModel(model.id)}
              testStatus={modelTestResults[model.id]}
              onTest={() => handleTestModel(model.id)}
              isTesting={testingModelId === model.id}
              isCustom
              health={healthByModel[model.id]}
              isSelected={selectedModelIds.has(model.id)}
              onToggleSelect={() => {
                setSelectedModelIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(model.id)) next.delete(model.id);
                  else next.add(model.id);
                  return next;
                });
              }}
            />
          ))}

          <button
            onClick={() => setShowAddCustomModel(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-black/15 dark:border-white/15 text-xs text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Add Model
          </button>
        </div>
      </Card>

      <AddCustomModelModal
        isOpen={showAddCustomModel}
        onSave={async (modelId) => {
          await handleAddCustomModel(modelId);
          setShowAddCustomModel(false);
        }}
        onClose={() => setShowAddCustomModel(false)}
      />

      <AddToComboModal
        isOpen={showAddToCombo}
        onClose={() => setShowAddToCombo(false)}
        selectedModels={Array.from(selectedModelIds).map((id) => `${providerAlias}/${id}`)}
        onSuccess={({ comboName, addedCount }) => {
          setFeedback({
            type: "success",
            text: `Added ${addedCount} model${addedCount === 1 ? "" : "s"} to combo "${comboName}".`,
          });
        }}
      />

      <ConfirmModal
        isOpen={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={async () => {
          const idsToDelete = Array.from(selectedModelIds);
          setShowConfirmDelete(false);
          let removed = 0;
          for (const id of idsToDelete) {
            if (myCustomModels.some((m) => m.id === id)) {
              await handleDeleteCustomModel(id);
              removed++;
            } else if (modelAliases[id]) {
              await handleDeleteAlias(id);
              removed++;
            }
          }
          setSelectedModelIds(new Set());
          setFeedback({
            type: "success",
            text: `Removed ${removed} custom model${removed === 1 ? "" : "s"}.`,
          });
        }}
        title="Remove Selected Custom Models"
        message={`Are you sure you want to remove the custom models among the ${selectedModelIds.size} selected items? Built-in provider models cannot be deleted.`}
        confirmText="Remove"
        variant="danger"
      />
    </>
  );
}

ModelsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  kindFilter: PropTypes.string, // e.g. "tts", "embedding" — filters models shown
  providerAliasOverride: PropTypes.string, // override alias (e.g. for custom-embedding nodes using prefix)
};
