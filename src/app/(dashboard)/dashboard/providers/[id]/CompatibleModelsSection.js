"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Button, ConfirmModal, AddToComboModal, ModelListBulkActionsBar } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import ModelHealthBadge from "@/shared/components/ModelHealthBadge";
import ComboMembershipChips from "@/shared/components/ComboMembershipChips";
import ModelListFilterBar from "@/shared/components/ModelListFilterBar";
import { filterModelRows, HEALTH_FILTER_ALL } from "@/shared/utils/modelHealthFilter";

// Single source of the model-health fetch: used by the mount effect below and
// by refreshHealth() after test/validate actions — never duplicated.
async function fetchModelHealth(provider) {
  const res = await fetch(`/api/model-health?provider=${encodeURIComponent(provider)}`);
  const data = await res.json();
  return data.health || null;
}

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, health, isSelected, onToggleSelect }) {
  const borderColor = isSelected
    ? "border-primary/60 bg-primary/5"
    : testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50 transition-colors`}>
      <input
        type="checkbox"
        checked={!!isSelected}
        onChange={onToggleSelect}
        aria-label={`Select model ${modelId}`}
        className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer shrink-0"
      />
      <span
        className="material-symbols-outlined text-base text-text-muted shrink-0"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{modelId}</p>
          <ModelHealthBadge health={health} />
          <ComboMembershipChips fullModel={fullModel} />
        </div>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [healthByModel, setHealthByModel] = useState({});
  const [validating, setValidating] = useState(false);
  const [validateFeedback, setValidateFeedback] = useState(null); // {type:"error"|"success", text}
  const [filterQuery, setFilterQuery] = useState("");
  const [filterTag, setFilterTag] = useState(HEALTH_FILTER_ALL);
  const [selectedModelIds, setSelectedModelIds] = useState(() => new Set());
  const [showAddToCombo, setShowAddToCombo] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [bulkTesting, setBulkTesting] = useState(false);
  const activeConnection = connections.find((conn) => conn.isActive !== false);

  const refreshHealth = useCallback(async () => {
    try {
      const health = await fetchModelHealth(providerStorageAlias);
      if (health) setHealthByModel(health);
    } catch {
      // badge state stays empty (unknown) on failure
    }
  }, [providerStorageAlias]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await fetchModelHealth(providerStorageAlias);
        if (!cancelled && health) setHealthByModel(health);
      } catch {
        // badge state stays empty (unknown) on failure
      }
    })();
    return () => { cancelled = true; };
  }, [providerStorageAlias]);

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
      refreshHealth();
    }
  };

  const handleValidateAll = async () => {
    if (validating || !activeConnection) return;
    setValidating(true);
    setValidateFeedback(null);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/test-models`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setValidateFeedback({
          type: "error",
          text: data?.error || `Validate all failed (HTTP ${res.status}). Check the connection and try again.`,
        });
        return;
      }
      const results = data.results || [];
      const okMap = {};
      let okCount = 0;
      for (const r of results) {
        okMap[r.modelId] = r.ok ? "ok" : "error";
        if (r.ok) okCount += 1;
      }
      setModelTestResults(okMap);
      const failedCount = results.length - okCount;
      setValidateFeedback({
        type: "success",
        text: results.length === 0
          ? "No models to validate for this connection."
          : `Validated ${results.length} model${results.length === 1 ? "" : "s"} — ${okCount} ok, ${failedCount} failed.`,
      });
    } catch (e) {
      setValidateFeedback({ type: "error", text: `Validate all failed: ${e?.message || "network error"}` });
    } finally {
      setValidating(false);
      refreshHealth();
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const visibleModels = filterModelRows(allModels, { query: filterQuery, tag: filterTag, healthByModel });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }
    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    if (!activeConnection) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) alert("No new models were added.");
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
        <Button size="sm" variant="secondary" icon="science" onClick={handleValidateAll} disabled={!canImport || validating}>
          {validating ? "Validating..." : "Validate all"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing and validating models.
        </p>
      )}

      {validateFeedback && (
        <p className={`text-xs ${validateFeedback.type === "error" ? "text-red-500" : "text-green-500"}`} role="status">
          {validateFeedback.text}
        </p>
      )}

      {allModels.length > 0 && (
        <>
          <ModelListFilterBar
            query={filterQuery}
            onQueryChange={setFilterQuery}
            tag={filterTag}
            onTagChange={setFilterTag}
            shown={visibleModels.length}
            total={allModels.length}
            allSelected={visibleModels.length > 0 && visibleModels.every((m) => selectedModelIds.has(m.id))}
            onToggleSelectAll={() => {
              const allSelected = visibleModels.length > 0 && visibleModels.every((m) => selectedModelIds.has(m.id));
              setSelectedModelIds((prev) => {
                const next = new Set(prev);
                for (const m of visibleModels) {
                  if (allSelected) next.delete(m.id);
                  else next.add(m.id);
                }
                return next;
              });
            }}
          />
          <ModelListBulkActionsBar
            selectedCount={selectedModelIds.size}
            allSelected={visibleModels.length > 0 && visibleModels.every((m) => selectedModelIds.has(m.id))}
            onToggleSelectAll={() => {
              const allSelected = visibleModels.length > 0 && visibleModels.every((m) => selectedModelIds.has(m.id));
              setSelectedModelIds((prev) => {
                const next = new Set(prev);
                for (const m of visibleModels) {
                  if (allSelected) next.delete(m.id);
                  else next.add(m.id);
                }
                return next;
              });
            }}
            onClearSelection={() => setSelectedModelIds(new Set())}
            onTestSelected={connections.length > 0 ? async () => {
              if (bulkTesting || selectedModelIds.size === 0) return;
              setBulkTesting(true);
              setValidateFeedback(null);
              const ids = Array.from(selectedModelIds);
              let okCount = 0;
              for (const mid of ids) {
                setTestingModelId(mid);
                try {
                  const res = await fetch("/api/models/test", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: `${providerStorageAlias}/${mid}` }),
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
              refreshHealth();
              setValidateFeedback({
                type: okCount === ids.length ? "success" : "error",
                text: `Tested ${ids.length} model${ids.length === 1 ? "" : "s"} — ${okCount} ok, ${ids.length - okCount} failed.`,
              });
            } : undefined}
            isTesting={bulkTesting}
            testDisabled={!canImport || bulkTesting}
            onAddToCombo={() => setShowAddToCombo(true)}
            onDeleteSelected={() => setShowConfirmDelete(true)}
          />
        </>
      )}

      {allModels.length > 0 && visibleModels.length === 0 && (
        <p className="text-xs text-text-muted">No models match this filter.</p>
      )}

      {visibleModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {visibleModels.map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              isTesting={testingModelId === id}
              health={healthByModel[id]}
              isSelected={selectedModelIds.has(id)}
              onToggleSelect={() => {
                setSelectedModelIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}
      <AddToComboModal
        isOpen={showAddToCombo}
        onClose={() => setShowAddToCombo(false)}
        selectedModels={Array.from(selectedModelIds).map((id) => `${providerDisplayAlias}/${id}`)}
        onSuccess={({ comboName, addedCount }) => {
          setValidateFeedback({
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
          for (const id of idsToDelete) {
            const item = allModels.find((m) => m.id === id);
            if (item?.source === "custom") {
              await onDeleteCustomModel(id);
            } else if (item?.alias) {
              await onDeleteAlias(item.alias);
            }
          }
          setSelectedModelIds(new Set());
          setValidateFeedback({
            type: "success",
            text: `Removed ${idsToDelete.length} model${idsToDelete.length === 1 ? "" : "s"}.`,
          });
        }}
        title="Remove Selected Models"
        message={`Are you sure you want to remove ${selectedModelIds.size} selected model${selectedModelIds.size === 1 ? "" : "s"}?`}
        confirmText="Remove"
        variant="danger"
      />
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
