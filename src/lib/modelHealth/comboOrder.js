// Combo ordering: ranks models by a score while locked models keep their exact
// position. Pure (no DB, no imports from src) so both callers can share it:
//   - the ranking-driven reorder (POST /api/combos/[id]/reorder)
//   - the runtime health sorter (healthSorter), so a locked model is never moved
//     by failing/slow deprioritization either.

/**
 * @param {string[]} models - Current combo order (provider/model strings).
 * @param {object} options
 * @param {Iterable<string>} [options.locked] - Models whose index must not change.
 * @param {Map<string, number>|object} [options.scoreByModel] - Higher = earlier.
 * @param {number} [options.unscoredScore] - Score for models with no entry.
 * @returns {string[]} New order, same length and same members.
 */
export function reorderComboModels(models, { locked, scoreByModel, unscoredScore = 0 } = {}) {
  const list = Array.isArray(models) ? models : [];
  if (list.length <= 1) return [...list];

  const lockedSet = new Set(locked || []);
  const scoreOf = (model) => {
    if (scoreByModel instanceof Map) {
      return scoreByModel.has(model) ? scoreByModel.get(model) : unscoredScore;
    }
    if (scoreByModel && typeof scoreByModel === "object" && model in scoreByModel) {
      return scoreByModel[model];
    }
    return unscoredScore;
  };

  const movable = [];
  list.forEach((model, index) => {
    if (!lockedSet.has(model)) movable.push({ model, index });
  });
  if (movable.length <= 1) return [...list];

  // Stable: equal scores keep their current relative order.
  movable.sort((a, b) => (scoreOf(b.model) - scoreOf(a.model)) || (a.index - b.index));

  const out = new Array(list.length);
  list.forEach((model, index) => {
    if (lockedSet.has(model)) out[index] = model;
  });
  let next = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === undefined) {
      out[i] = movable[next].model;
      next += 1;
    }
  }
  return out;
}

/**
 * True when the order would actually change — lets callers skip needless writes.
 */
export function orderChanged(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return true;
  return before.some((model, index) => model !== after[index]);
}

/**
 * Position-preserving order for the runtime health sorter: better health rank =
 * higher score. Entries the caller could not rank keep `unscoredScore` and stay
 * in place relative to each other.
 */
export function reorderByRank(models, { locked, rankByModel, maxRank = 0, unscoredScore = 0 } = {}) {
  const scoreByModel = new Map();
  for (const model of models || []) {
    const rank = rankByModel instanceof Map ? rankByModel.get(model) : rankByModel?.[model];
    // Lower rank number = healthier; convert to a descending score.
    scoreByModel.set(model, typeof rank === "number" ? (maxRank + 1 - rank) : unscoredScore);
  }
  return reorderComboModels(models, { locked, scoreByModel, unscoredScore });
}
