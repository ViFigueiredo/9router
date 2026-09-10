// Filters provider model rows by free-text query and health tag.
// Pure and dependency-free (unit-testable); rows are the objects rendered by
// the provider model lists ({ id, ... }) and healthByModel maps id → snapshot.

export const HEALTH_FILTER_ALL = "all";
export const HEALTH_FILTER_UNKNOWN = "unknown";

export const HEALTH_FILTER_OPTIONS = [
  { value: HEALTH_FILTER_ALL, label: "All" },
  { value: "ok", label: "ok" },
  { value: "slow", label: "slow" },
  { value: "failing", label: "failing" },
  { value: HEALTH_FILTER_UNKNOWN, label: "no data" },
];

export function healthTagOf(healthByModel, modelId) {
  const tag = healthByModel && healthByModel[modelId] && healthByModel[modelId].tag;
  return tag || HEALTH_FILTER_UNKNOWN;
}

export function filterModelRows(rows, { query = "", tag = HEALTH_FILTER_ALL, healthByModel = {} } = {}) {
  if (!Array.isArray(rows)) return [];
  const q = String(query || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (!row) return false;
    const id = String(row.id ?? "");
    if (q && !id.toLowerCase().includes(q) && !String(row.name ?? "").toLowerCase().includes(q)) {
      return false;
    }
    if (tag && tag !== HEALTH_FILTER_ALL && healthTagOf(healthByModel, id) !== tag) {
      return false;
    }
    return true;
  });
}
