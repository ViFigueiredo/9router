import { NextResponse } from "next/server";
import { readBrandingIcon, readDefaultIcon } from "@/lib/brandingIcon";

export const dynamic = "force-dynamic";

// GET /favicon.ico — served from settings, not a static file.
//
// Firefox reloads bookmark favicons from this path instead of using <link rel="icon">
// (mozilla bug 2010865), so it must return the configured icon; otherwise bookmarks
// keep showing the icon that shipped with the build.
//
// The bytes are returned directly (no redirect): a redirect built from request.url
// would point at the container's internal host and be unreachable from the browser.
// An ETag keyed on the icon content keeps revalidation cheap while letting the icon
// change take effect, and the versioned URL from the metadata stays immutable.
export async function GET() {
  const icon = (await readBrandingIcon()) || (await readDefaultIcon());
  if (!icon) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(icon.buffer, {
    headers: {
      "Content-Type": icon.mime,
      "Cache-Control": "public, max-age=0, must-revalidate",
      ETag: `"${icon.version}"`,
      "Content-Length": String(icon.buffer.length),
    },
  });
}
