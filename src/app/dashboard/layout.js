import { DEFAULT_FAVICON, DEFAULT_TITLE, TITLE_SUFFIX } from "@/shared/constants/branding";

// Pages outside the (dashboard) route group (e.g. /dashboard/settings/pricing) do not
// inherit its dynamic config; without this they prerender with the build-time default
// branding and the browser flips back to it on navigation.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const branding = settings?.branding || {};
    const name = String(branding.appName || "").trim();
    return {
      title: name ? `${name} - ${TITLE_SUFFIX}` : DEFAULT_TITLE,
      icons: { icon: branding.faviconDataUrl || DEFAULT_FAVICON },
    };
  } catch {
    return { title: DEFAULT_TITLE, icons: { icon: DEFAULT_FAVICON } };
  }
}

export default function DashboardSegmentLayout({ children }) {
  return children;
}
