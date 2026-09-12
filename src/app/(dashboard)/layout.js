import { DashboardLayout } from "@/shared/components";
import { DEFAULT_FAVICON, DEFAULT_TITLE, TITLE_SUFFIX } from "@/shared/constants/branding";
import { brandingIconUrl } from "@/lib/brandingIcon";

// Branding lives in per-instance settings, so this segment must render per request:
// a prerendered dashboard keeps the build-time default title/favicon in its HTML and
// RSC payload, and the browser flips back to it as soon as the user navigates.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const branding = settings?.branding || {};
    const name = String(branding.appName || "").trim();
    return {
      title: name ? `${name} - ${TITLE_SUFFIX}` : DEFAULT_TITLE,
      icons: { icon: brandingIconUrl(branding.faviconDataUrl) },
    };
  } catch {
    // A settings read must never break rendering.
    return { title: DEFAULT_TITLE, icons: { icon: DEFAULT_FAVICON } };
  }
}

export default function DashboardRootLayout({ children }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
