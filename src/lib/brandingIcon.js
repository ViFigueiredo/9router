// Branding icon served as a real resource instead of a data URL.
//
// Firefox is known to reload bookmark favicons from /favicon.ico instead of honouring
// <link rel="icon"> (mozilla bug 2010865), and its favicon database is sticky about
// data URIs, so the configured icon must be reachable at a stable, cacheable URL.
import { createHash } from "node:crypto";
import { DEFAULT_FAVICON } from "@/shared/constants/branding";

const DATA_URL_RE = /^data:([^;,]+)(;base64)?,(.*)$/s;

export function parseDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = DATA_URL_RE.exec(value.trim());
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  try {
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    if (buffer.length === 0) return null;
    return { mime: mime || "application/octet-stream", buffer };
  } catch {
    return null;
  }
}

/** Short content hash, used as a cache-busting `?v=` so browsers refetch on change. */
export function iconVersion(dataUrl) {
  if (!dataUrl) return "";
  return createHash("sha256").update(dataUrl).digest("hex").slice(0, 12);
}

/** Configured favicon as bytes, or null when none is set (fallback to /favicon.svg). */
export async function readBrandingIcon() {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const dataUrl = settings?.branding?.faviconDataUrl || "";
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;
    return { ...parsed, version: iconVersion(dataUrl) };
  } catch {
    return null;
  }
}

/** URL the metadata/manifest/client should point at, cache-busted per icon content. */
export function brandingIconUrl(faviconDataUrl) {
  if (!faviconDataUrl) return DEFAULT_FAVICON;
  return `/api/branding/icon?v=${iconVersion(faviconDataUrl)}`;
}

/**
 * Shipped SVG icon, for when the instance has no favicon configured.
 * Served from disk rather than redirected: a redirect built from `request.url`
 * points at the container's internal host (e.g. https://0.0.0.0:20128), which the
 * browser cannot follow.
 */
export async function readDefaultIcon() {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const buffer = await readFile(join(process.cwd(), "public", DEFAULT_FAVICON.replace(/^\//, "")));
    return { mime: "image/svg+xml", buffer, version: "default" };
  } catch {
    return null;
  }
}
