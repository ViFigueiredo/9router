import { NextResponse } from "next/server";
import { getComboById } from "@/lib/db/repos/combosRepo.js";
import { getComboOrdering, setComboOrdering } from "@/lib/comboOrdering.js";

export const dynamic = "force-dynamic";

/** GET /api/combos/[id]/ordering → { lockedModels, autoReorder } */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    return NextResponse.json(await getComboOrdering(combo.name));
  } catch (error) {
    console.log("Error reading combo ordering:", error);
    return NextResponse.json({ error: "Failed to read combo ordering" }, { status: 500 });
  }
}

/**
 * PATCH /api/combos/[id]/ordering  { lockedModels?, autoReorder? }
 * Locks are validated against the combo's own models so a stale lock can never
 * pin an index for a model that is no longer in the combo.
 */
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const patch = {};

    if (body && Object.prototype.hasOwnProperty.call(body, "lockedModels")) {
      if (!Array.isArray(body.lockedModels)) {
        return NextResponse.json({ error: "lockedModels must be an array" }, { status: 400 });
      }
      const inCombo = new Set(Array.isArray(combo.models) ? combo.models : []);
      patch.lockedModels = [...new Set(body.lockedModels.filter((m) => typeof m === "string" && inCombo.has(m)))];
    }
    if (body && Object.prototype.hasOwnProperty.call(body, "autoReorder")) {
      patch.autoReorder = body.autoReorder === true;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const next = await setComboOrdering(combo.name, patch);
    return NextResponse.json(next);
  } catch (error) {
    console.log("Error updating combo ordering:", error);
    return NextResponse.json({ error: "Failed to update combo ordering" }, { status: 500 });
  }
}
