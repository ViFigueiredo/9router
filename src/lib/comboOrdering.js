// Per-combo ordering preferences (position locks + optional auto reorder) kept in
// the global settings JSON, keyed by combo NAME — the same key the runtime uses
// when it resolves a combo (`comboStrategies` follows this convention too).
import { getSettings, updateSettings } from "@/lib/db/index.js";

export const COMBO_ORDERING_DEFAULTS = { lockedModels: [], autoReorder: false };

export function readComboOrdering(settings, comboName) {
  const entry = (settings?.comboOrdering || {})[comboName] || {};
  return {
    lockedModels: Array.isArray(entry.lockedModels)
      ? entry.lockedModels.filter((m) => typeof m === "string" && m)
      : [],
    autoReorder: entry.autoReorder === true,
  };
}

export async function getComboOrdering(comboName) {
  if (!comboName) return { ...COMBO_ORDERING_DEFAULTS };
  const settings = await getSettings();
  return readComboOrdering(settings, comboName);
}

// Atomic read-merge-write of the whole map (updateSettings merges the key).
export async function setComboOrdering(comboName, patch) {
  const settings = await getSettings();
  const current = settings.comboOrdering || {};
  const prev = readComboOrdering(settings, comboName);
  const next = { ...prev, ...patch };
  const updated = { ...current };
  if (next.lockedModels.length === 0 && next.autoReorder === false) {
    delete updated[comboName]; // keep settings clean when nothing is configured
  } else {
    updated[comboName] = next;
  }
  await updateSettings({ comboOrdering: updated });
  return next;
}

export async function listComboOrdering() {
  const settings = await getSettings();
  const current = settings.comboOrdering || {};
  return Object.keys(current).map((comboName) => ({ comboName, ...readComboOrdering(settings, comboName) }));
}

// Keys are combo names, so a rename must carry the entry across or the locks
// silently detach.
export async function renameComboOrdering(fromName, toName) {
  if (!fromName || !toName || fromName === toName) return false;
  const settings = await getSettings();
  const current = { ...(settings.comboOrdering || {}) };
  if (!current[fromName]) return false;
  current[toName] = current[fromName];
  delete current[fromName];
  await updateSettings({ comboOrdering: current });
  return true;
}

export async function clearComboOrdering(comboName) {
  if (!comboName) return false;
  const settings = await getSettings();
  if (!(settings.comboOrdering || {})[comboName]) return false;
  const current = { ...(settings.comboOrdering || {}) };
  delete current[comboName];
  await updateSettings({ comboOrdering: current });
  return true;
}
