import { NextResponse } from "next/server";
import { DEFAULT_FAVICON } from "@/shared/constants/branding";

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
  const icon = branding.faviconDataUrl || DEFAULT_FAVICON;
  const isSvg = icon.startsWith("/") && icon.endsWith(".svg");

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
      {
        src: icon,
        sizes: "any",
        type: isSvg ? "image/svg+xml" : null,
      },
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ].map((entry) => (entry.type === null ? { src: entry.src, sizes: entry.sizes } : entry)),
  }, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "no-store",
    },
  });
}
