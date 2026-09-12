import { NextResponse } from "next/server";
import { readBrandingIcon } from "@/lib/brandingIcon";
import { DEFAULT_FAVICON } from "@/shared/constants/branding";

export const dynamic = "force-dynamic";

// GET /favicon.ico — served from settings, not a static file.
//
// Firefox reloads bookmark favicons from this path instead of using <link rel="icon">
// (mozilla bug 2010865), so it must return the configured icon; otherwise bookmarks
// keep showing whatever icon was shipped with the build.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const icon = await readBrandingIcon();

  if (!icon) {
    return NextResponse.redirect(new URL(DEFAULT_FAVICON, request.url), 302);
  }
  if (searchParams.get("v") !== icon.version) {
    // Send browsers to the versioned URL so the cache busts when the icon changes.
    return NextResponse.redirect(new URL(`/favicon.ico?v=${icon.version}`, request.url), 302);
  }

  return new NextResponse(icon.buffer, {
    headers: {
      "Content-Type": icon.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(icon.buffer.length),
    },
  });
}
