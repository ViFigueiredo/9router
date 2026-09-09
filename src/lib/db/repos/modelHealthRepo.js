import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export const MODEL_HEALTH_SCOPE = "modelHealth";

export async function getModelHealth() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [MODEL_HEALTH_SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, null) || {};
  return out;
}

export async function getModelHealthByProvider(provider) {
  if (!provider) return {};
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [MODEL_HEALTH_SCOPE, provider]);
  return row ? (parseJson(row.value, null) || {}) : {};
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
// updater(prev) returns the next ModelHealth, or null to delete the entry.
export async function updateModelHealth(provider, modelId, updater) {
  if (!provider || !modelId || typeof updater !== "function") return;
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [MODEL_HEALTH_SCOPE, provider]);
    const map = row ? (parseJson(row.value, null) || {}) : {};
    const prev = map[modelId] || null;
    const next = updater(prev);
    if (next === null || next === undefined) {
      delete map[modelId];
    } else {
      map[modelId] = next;
    }
    const keys = Object.keys(map);
    if (keys.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [MODEL_HEALTH_SCOPE, provider]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [MODEL_HEALTH_SCOPE, provider, stringifyJson(map)]
      );
    }
  });
}
