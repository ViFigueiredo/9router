import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/branding — public branding for unauthenticated pages (login, landing).
// Only the presentation fields are exposed: the name, logo, favicon and palette are
// what those pages render anyway. Settings stay behind the dashboard session.
export async function GET() {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const branding = settings?.branding || {};
    return NextResponse.json({
      appName: branding.appName || "",
      logoDataUrl: branding.logoDataUrl || "",
      faviconDataUrl: branding.faviconDataUrl || "",
      primaryColor: branding.primaryColor || "",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { appName: "", logoDataUrl: "", faviconDataUrl: "", primaryColor: "" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
