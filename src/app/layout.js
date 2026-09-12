import Script from "next/script";
import { Inter } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "material-symbols/outlined.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import BrandingProvider from "@/shared/components/BrandingProvider";
import { DEFAULT_FAVICON, DEFAULT_TITLE, TITLE_SUFFIX } from "@/shared/constants/branding";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const APP_TITLE = DEFAULT_TITLE;
const APP_DESCRIPTION = "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.";

// Branding is per-instance state read from settings, so every route must render per
// request: a prerendered page (login, landing) keeps the build-time default title,
// favicon and manifest in its HTML, and the browser shows it instead of the
// configured branding.
export const dynamic = "force-dynamic";

// Branding is derived from settings so Next itself renders the configured title and
// favicon. Mutating document.head from the client is not enough: React reconciles
// the metadata tags on every navigation and would restore the static values.
export async function generateMetadata() {
  const fallback = {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    manifest: "/manifest.webmanifest",
    icons: { icon: DEFAULT_FAVICON },
  };
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    const branding = settings?.branding || {};
    const name = String(branding.appName || "").trim();
    return {
      title: name ? `${name} - ${TITLE_SUFFIX}` : APP_TITLE,
      description: APP_DESCRIPTION,
      manifest: "/manifest.webmanifest",
      icons: { icon: branding.faviconDataUrl || DEFAULT_FAVICON },
    };
  } catch {
    // Never let a settings read break rendering (e.g. during a cold build).
    return fallback;
  }
}

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className={`${inter.variable} font-sans antialiased`}>
        {/* Apply persisted theme before first paint so a reload does not flash the
            default (light) theme before the client store hydrates. Mirrors the
            zustand-persist "theme" key and the `dark` class applyTheme() sets. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');var t=s?(JSON.parse(s).state||{}).theme:'system';t=t||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t==='system'&&m)){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
        <Script
          id="fonts-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `var d=document,r=d.documentElement,f=function(){r.classList.add('fonts-loaded')};if(d.fonts&&d.fonts.load){d.fonts.load('24px "Material Symbols Outlined"').then(f).catch(f);setTimeout(f,3000)}else{f()}`,
          }}
        />
        <ThemeProvider>
          <BrandingProvider>
            <RuntimeI18nProvider>
              {children}
            </RuntimeI18nProvider>
          </BrandingProvider>
        </ThemeProvider>
        <GoogleAnalytics gaId={"G-LC959F603F"} />
      </body>
    </html>
  );
}
