import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { revalidateProviderModels } from "@/lib/modelHealth/revalidate.js";

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through the internal endpoint that matches each model kind.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const providerId = connection.provider;
    const { results, empty } = await revalidateProviderModels(providerId, { connectionId: id });
    if (empty) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }
    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.log("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
