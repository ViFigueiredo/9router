import { NextResponse } from "next/server";
import { buildGlobalRanking } from "@/lib/modelHealth/globalRanking.js";

export const dynamic = "force-dynamic";

// GET /api/ranking?provider=&kind=&measuredOnly= → global provider/model ranking
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "";
    const kind = searchParams.get("kind") || "";
    const measuredOnly = searchParams.get("measuredOnly") !== "false";

    const { scoreByModel, ...payload } = await buildGlobalRanking({ provider, kind, measuredOnly });
    void scoreByModel; // in-process consumers only; not part of the HTTP payload
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error building ranking:", error);
    return NextResponse.json({ error: "Failed to build ranking" }, { status: 500 });
  }
}
