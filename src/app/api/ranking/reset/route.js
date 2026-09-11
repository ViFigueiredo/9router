import { NextResponse } from "next/server";
import { resetModelStats } from "@/lib/db/repos/modelHealthRepo.js";

// POST /api/ranking/reset  { provider, model? } → zero accumulated ranking counters.
// The 1h event window and the health tags are left untouched.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : null;
    if (!provider) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const changed = await resetModelStats(provider, model);
    return NextResponse.json({ ok: true, provider, model, changed });
  } catch (error) {
    console.log("Error resetting ranking counters:", error);
    return NextResponse.json({ error: "Failed to reset counters" }, { status: 500 });
  }
}
