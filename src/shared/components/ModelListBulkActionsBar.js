"use client";

import PropTypes from "prop-types";
import { Button } from "@/shared/components";

export default function ModelListBulkActionsBar({
  selectedCount,
  allSelected,
  onToggleSelectAll,
  onClearSelection,
  onTestSelected,
  isTesting = false,
  testDisabled = false,
  onAddToCombo,
  onDeleteSelected,
  deleteDisabled = false,
}) {
  if (selectedCount <= 0) return null;

  return (
    <div className="flex items-center justify-between flex-wrap gap-2.5 p-2.5 rounded-lg bg-primary/10 border border-primary/30 text-sm">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer font-medium text-text">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
          />
          <span>{selectedCount} model{selectedCount === 1 ? "" : "s"} selected</span>
        </label>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs text-text-muted hover:text-primary transition-colors underline ml-1"
        >
          Clear
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {onTestSelected && (
          <Button
            size="sm"
            variant="secondary"
            icon="science"
            onClick={onTestSelected}
            loading={isTesting}
            disabled={isTesting || testDisabled}
          >
            {isTesting ? "Testing..." : `Test (${selectedCount})`}
          </Button>
        )}
        {onAddToCombo && (
          <Button
            size="sm"
            variant="secondary"
            icon="playlist_add"
            onClick={onAddToCombo}
            disabled={isTesting}
          >
            Add to Combo
          </Button>
        )}
        {onDeleteSelected && (
          <Button
            size="sm"
            variant="danger"
            icon="delete"
            onClick={onDeleteSelected}
            disabled={isTesting || deleteDisabled}
          >
            Remove ({selectedCount})
          </Button>
        )}
      </div>
    </div>
  );
}

ModelListBulkActionsBar.propTypes = {
  selectedCount: PropTypes.number.isRequired,
  allSelected: PropTypes.bool.isRequired,
  onToggleSelectAll: PropTypes.func.isRequired,
  onClearSelection: PropTypes.func.isRequired,
  onTestSelected: PropTypes.func,
  isTesting: PropTypes.bool,
  testDisabled: PropTypes.bool,
  onAddToCombo: PropTypes.func,
  onDeleteSelected: PropTypes.func,
  deleteDisabled: PropTypes.bool,
};
