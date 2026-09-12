import { NextResponse } from "next/server";
import { readBrandingIcon } from "@/lib/brandingIcon";
import { DEFAULT_FAVICON } from "@/shared/constants/branding";

export const dynamic = "force-dynamic";

// GET /api/branding/icon?v=<hash> — the configured favicon bytes.
// Falls back to the shipped SVG when nothing is configured.
export async function GET(request) {
  const icon = await readBrandingIcon();
  if (!icon) {
    return NextResponse.redirect(new URL(DEFAULT_FAVICON, request.url), 302);
  }
  const versioned = new URL(request.url).searchParams.has("v");
  return new NextResponse(icon.buffer, {
    headers: {
      "Content-Type": icon.mime,
      // The ?v= hash changes with the icon, so a versioned URL is immutable.
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "no-cache",
      "Content-Length": String(icon.buffer.length),
    },
  });
}
