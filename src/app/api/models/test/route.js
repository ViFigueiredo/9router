import { NextResponse } from "next/server";
import { pingModelByKind } from "./ping";
import { recordObservation } from "@/lib/modelHealth/sink.js";
import { getModelInfo } from "@/sse/services/model.js";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const result = await pingModelByKind(model, kind || "llm");
    const info = await getModelInfo(model).catch(() => null);
    const inconclusive = !result.ok && /timeout|aborted/i.test(String(result.error || ""));
    await recordObservation({
      provider: info?.provider || "unknown",
      model: info?.model || model,
      kind: kind || "llm",
      ok: !!result.ok,
      status: result.status ?? null,
      ttftMs: typeof result.latencyMs === "number" ? result.latencyMs : null,
      isPing: true,
      ...(inconclusive ? { fatalOverride: false } : {}),
    });
    if (result.ok) result.tag = "ok";
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
