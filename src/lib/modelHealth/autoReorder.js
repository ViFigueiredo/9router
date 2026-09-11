// Auto reorder of combos that opted in (`autoReorder: true`), run after a
// revalidation cycle. Fail-open: ordering is a convenience, never a request path.
import { getCombos, updateCombo } from "@/lib/db/repos/combosRepo.js";
import { listComboOrdering } from "@/lib/comboOrdering.js";
import { buildGlobalRanking } from "./globalRanking.js";
import { reorderComboModels, orderChanged } from "./comboOrder.js";

export async function autoReorderCombos(deps = {}) {
  const readCombos = deps.getCombos || getCombos;
  const writeCombo = deps.updateCombo || updateCombo;
  const readOrdering = deps.listComboOrdering || listComboOrdering;
  const buildRanking = deps.buildGlobalRanking || buildGlobalRanking;

  try {
    const ordering = await readOrdering();
    const auto = ordering.filter((entry) => entry.autoReorder);
    if (auto.length === 0) return { reordered: [] };

    const combos = await readCombos();
    const byName = new Map((combos || []).map((combo) => [combo.name, combo]));
    const { scoreByModel } = await buildRanking({ measuredOnly: true });

    const reordered = [];
    for (const entry of auto) {
      const combo = byName.get(entry.comboName);
      if (!combo) continue;
      const models = Array.isArray(combo.models) ? combo.models : [];
      const next = reorderComboModels(models, {
        locked: entry.lockedModels,
        scoreByModel,
        unscoredScore: -1,
      });
      if (!orderChanged(models, next)) continue;
      await writeCombo(combo.id, { models: next });
      reordered.push(combo.name);
    }
    return { reordered };
  } catch (e) {
    console.warn("[Reorder] auto reorder failed:", e?.message || e);
    return { reordered: [] };
  }
}
