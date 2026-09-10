"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

export default function AddToComboModal({ isOpen, onClose, selectedModels = [], onSuccess }) {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedComboId, setSelectedComboId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/combos");
        const data = await res.json();
        if (cancelled) return;
        const list = data.combos || [];
        setCombos(list);
        if (list.length > 0) {
          setSelectedComboId((prev) => prev || list[0].id);
        }
      } catch {
        if (!cancelled) setError("Failed to load combos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);
  const targetCombo = combos.find((c) => c.id === selectedComboId) || combos[0];
  const existingModels = Array.isArray(targetCombo?.models) ? targetCombo.models : [];
  const alreadyInComboCount = selectedModels.filter((m) => existingModels.includes(m)).length;
  const newModelsCount = selectedModels.length - alreadyInComboCount;

  const handleAdd = async () => {
    if (!targetCombo) return;
    setSubmitting(true);
    setError("");
    try {
      const merged = Array.from(new Set([...existingModels, ...selectedModels]));
      const res = await fetch(`/api/combos/${targetCombo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: merged }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update combo");
        return;
      }
      window.dispatchEvent(new CustomEvent("combosChanged"));
      onSuccess?.({ comboName: targetCombo.name, addedCount: newModelsCount });
      onClose();
    } catch (err) {
      setError(err?.message || "Failed to update combo");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add to Existing Combo"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleAdd}
            loading={submitting}
            disabled={!targetCombo || selectedModels.length === 0 || loading}
          >
            Add {selectedModels.length} Model{selectedModels.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-xs text-red-500">{error}</p>}

        <p className="text-sm text-text-muted">
          Select an existing combo to add the {selectedModels.length} selected model{selectedModels.length === 1 ? "" : "s"} to:
        </p>

        {loading ? (
          <p className="text-xs text-text-muted">Loading combos...</p>
        ) : combos.length === 0 ? (
          <div className="p-3 bg-sidebar rounded-lg border border-border text-center">
            <p className="text-sm text-text-muted mb-2">No combos found.</p>
            <a href="/dashboard/combos" className="text-xs text-primary hover:underline">
              Create a combo first →
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="target-combo-select" className="text-xs text-text-muted font-medium">
              Target Combo
            </label>
            <select
              id="target-combo-select"
              value={targetCombo?.id || ""}
              onChange={(e) => setSelectedComboId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              {combos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({Array.isArray(c.models) ? c.models.length : 0} models)
                </option>
              ))}
            </select>

            {targetCombo && (
              <div className="text-xs text-text-muted mt-1 bg-sidebar/50 p-2.5 rounded border border-border">
                <span>Currently has {existingModels.length} model{existingModels.length === 1 ? "" : "s"}.</span>
                {alreadyInComboCount > 0 ? (
                  <span className="block text-amber-500 mt-0.5">
                    {alreadyInComboCount} model{alreadyInComboCount === 1 ? " is" : "s are"} already in this combo ({newModelsCount} will be added).
                  </span>
                ) : (
                  <span className="block text-green-500 mt-0.5">
                    All {newModelsCount} model{newModelsCount === 1 ? "" : "s"} will be added as new models.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-muted font-medium">Selected models:</span>
          <div className="max-h-36 overflow-y-auto flex flex-col gap-1 p-2 bg-sidebar rounded border border-border text-xs font-mono text-text-muted">
            {selectedModels.map((m) => (
              <div key={m} className="truncate">
                {m}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

AddToComboModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  selectedModels: PropTypes.arrayOf(PropTypes.string),
  onSuccess: PropTypes.func,
};
