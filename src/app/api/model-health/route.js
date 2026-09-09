import { NextResponse } from "next/server";
import { getHealthSnapshot } from "@/lib/modelHealth/sink.js";

export const dynamic = "force-dynamic";

// GET /api/model-health?provider=openai → per-model health badges for the UI
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    if (!provider) {
      return NextResponse.json({ error: "provider query param required" }, { status: 400 });
    }
    const health = await getHealthSnapshot(provider);
    return NextResponse.json({ provider, health });
  } catch (error) {
    console.log("Error reading model health:", error);
    return NextResponse.json({ health: {} }, { status: 500 });
  }
}
