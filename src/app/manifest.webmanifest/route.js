import { NextResponse } from "next/server";
import { brandingIconUrl } from "@/lib/brandingIcon";

export const dynamic = "force-dynamic";

async function readBranding() {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    return settings?.branding || {};
  } catch {
    return {};
  }
}

// GET /manifest.webmanifest — served per request so the name and icons follow the
// configured branding. A static app/manifest.js would bake the defaults into the
// build, and browsers take bookmark/PWA icons from here.
export async function GET() {
  const branding = await readBranding();
  const name = String(branding.appName || "").trim();
  const icon = brandingIconUrl(branding.faviconDataUrl);

  return NextResponse.json({
    name: name ? `${name} - AI Infrastructure Management` : "9Router - AI Infrastructure Management",
    short_name: name || "9Router",
    description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait-primary",
    icons: [
      // Configured icon first: Firefox/Chrome prefer the earlier, better-fitting entry.
      { src: icon, sizes: "any" },
      { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
      { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  }, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "no-store",
    },
  });
}
