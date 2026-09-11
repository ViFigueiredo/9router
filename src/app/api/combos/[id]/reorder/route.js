import { NextResponse } from "next/server";
import { getComboById, updateCombo } from "@/lib/db/repos/combosRepo.js";
import { getComboOrdering } from "@/lib/comboOrdering.js";
import { buildGlobalRanking } from "@/lib/modelHealth/globalRanking.js";
import { reorderComboModels, orderChanged } from "@/lib/modelHealth/comboOrder.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/combos/[id]/reorder
 * Reclassifies a combo's execution order by the global ranking, keeping
 * position-locked models at their exact index.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    const models = Array.isArray(combo.models) ? combo.models : [];
    const ordering = await getComboOrdering(combo.name);
    // Only measured models carry a score; unscored ones keep their relative order
    // at the tail (unscoredScore 0) instead of jumping ahead of measured ones.
    const { scoreByModel } = await buildGlobalRanking({ measuredOnly: true });
    const reordered = reorderComboModels(models, {
      locked: ordering.lockedModels,
      scoreByModel,
      unscoredScore: -1,
    });

    if (orderChanged(models, reordered)) {
      await updateCombo(combo.id, { models: reordered });
    }

    return NextResponse.json({
      ok: true,
      comboId: combo.id,
      changed: orderChanged(models, reordered),
      models: reordered,
      lockedModels: ordering.lockedModels,
      scored: models.filter((m) => scoreByModel.has(m)).length,
    });
  } catch (error) {
    console.log("Error reordering combo:", error);
    return NextResponse.json({ error: "Failed to reorder combo" }, { status: 500 });
  }
}
