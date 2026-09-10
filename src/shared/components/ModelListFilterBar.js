"use client";

import PropTypes from "prop-types";
import { HEALTH_FILTER_OPTIONS } from "@/shared/utils/modelHealthFilter";

// Compact toolbar above a provider model list: free-text search + health-tag select (+ optional select-all).
export default function ModelListFilterBar({ query, onQueryChange, tag, onTagChange, shown, total, allSelected, onToggleSelectAll }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {typeof onToggleSelectAll === "function" && (
        <label className="flex items-center gap-1.5 cursor-pointer px-1 py-1 rounded hover:bg-sidebar text-xs text-text-muted select-none shrink-0" title="Select / deselect all visible models">
          <input
            type="checkbox"
            checked={!!allSelected}
            onChange={onToggleSelectAll}
            className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
          />
          <span className="hidden sm:inline">Select all</span>
        </label>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search models..."
        aria-label="Search models"
        className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
      />
      <select
        value={tag}
        onChange={(e) => onTagChange(e.target.value)}
        aria-label="Filter by health tag"
        className="px-2 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary shrink-0"
      >
        {HEALTH_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="text-xs text-text-muted shrink-0">{shown}/{total}</span>
    </div>
  );
}

ModelListFilterBar.propTypes = {
  query: PropTypes.string.isRequired,
  onQueryChange: PropTypes.func.isRequired,
  tag: PropTypes.string.isRequired,
  onTagChange: PropTypes.func.isRequired,
  shown: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
};
