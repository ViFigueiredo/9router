import { NextResponse } from "next/server";
import { readBrandingIcon, readDefaultIcon } from "@/lib/brandingIcon";

export const dynamic = "force-dynamic";

// GET /api/branding/icon?v=<hash> — the configured favicon bytes.
// Falls back to the shipped SVG when nothing is configured. Always serves bytes
// (never a redirect built from request.url, which resolves to the container host).
export async function GET(request) {
  const icon = (await readBrandingIcon()) || (await readDefaultIcon());
  if (!icon) {
    return new NextResponse(null, { status: 404 });
  }
  const versioned = new URL(request.url).searchParams.has("v");
  return new NextResponse(icon.buffer, {
    headers: {
      "Content-Type": icon.mime,
      // The ?v= hash changes with the icon content, so a versioned URL is immutable.
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
      ETag: `"${icon.version}"`,
      "Content-Length": String(icon.buffer.length),
    },
  });
}
