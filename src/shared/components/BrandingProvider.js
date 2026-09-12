"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { brandingCssVars } from "@/shared/utils/brandColor";
import { BRANDING_EVENT, DEFAULT_FAVICON, DEFAULT_TITLE, TITLE_SUFFIX } from "@/shared/constants/branding";

const CSS_VAR_KEYS = [
  ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => `--color-brand-${s}`),
  "--color-primary",
  "--color-primary-hover",
  "--shadow-focus",
  "--shadow-warm",
];

// Marks the icon link this module creates, so it can be distinguished from the one
// the framework renders (and removed once the framework's exists).
const MANAGED_ATTR = "data-branding-icon";

// Module-level store: branding is applied to the live document (CSS vars, title,
// favicon) and read through useSyncExternalStore, so no component effect has to
// set state.
let brandingState = {};
const listeners = new Set();

export function getBrandingSnapshot() {
  return brandingState;
}

export function subscribeBranding(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply name/logo/colors to the live document (client-only, fail-open). */
export function applyBranding(branding) {
  if (typeof document === "undefined") return;
  const { appName = "", faviconDataUrl = "", faviconVersion = "", primaryColor = "" } = branding || {};
  const root = document.documentElement;

  const vars = primaryColor ? brandingCssVars(primaryColor) : null;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  } else {
    // Back to the shipped palette: drop the overrides, keep the stylesheet values.
    for (const key of CSS_VAR_KEYS) root.style.removeProperty(key);
  }

  const name = String(appName).trim();
  document.title = name ? `${name} - ${TITLE_SUFFIX}` : DEFAULT_TITLE;

  // Prefer a real, cache-busted URL: some browsers (Firefox in particular) handle
  // data-URI favicons poorly for bookmarks. Falls back to the data URL if the
  // endpoint payload predates the version field.
  const href = faviconDataUrl
    ? (faviconVersion ? `/api/branding/icon?v=${faviconVersion}` : faviconDataUrl)
    : DEFAULT_FAVICON;
  const links = [...document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')];
  // The framework renders its own icon link from generateMetadata; prefer that one
  // and drop the link we may have created before hydration, so the document keeps
  // exactly one icon tag instead of two competing ones.
  const owned = links.find((link) => !link.hasAttribute(MANAGED_ATTR));
  const managed = links.filter((link) => link.hasAttribute(MANAGED_ATTR));
  if (owned) {
    owned.setAttribute("href", href);
    for (const extra of managed) extra.remove();
  } else if (managed.length > 0) {
    for (const link of managed) link.setAttribute("href", href);
  } else {
    const link = document.createElement("link");
    link.setAttribute("rel", "icon");
    link.setAttribute(MANAGED_ATTR, "1");
    link.setAttribute("href", href);
    document.head.appendChild(link);
  }
}

export function setBrandingState(next) {
  brandingState = next || {};
  applyBranding(brandingState);
  for (const listener of listeners) listener();
}

const BrandingContext = createContext({});

export function useBranding() {
  return useContext(BrandingContext);
}

export default function BrandingProvider({ children }) {
  const branding = useSyncExternalStore(subscribeBranding, getBrandingSnapshot, getBrandingSnapshot);
  const pathname = usePathname();

  // Re-assert after every navigation: React reconciles the metadata tags it owns
  // (title/favicon) on route changes, so the applied values must be re-pushed.
  useEffect(() => {
    applyBranding(getBrandingSnapshot());
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Public endpoint: /api/settings needs a session, which unauthenticated pages
        // like the login screen never have.
        const res = await fetch("/api/branding", { cache: "no-store" });
        const data = res.ok ? await res.json() : {};
        if (!cancelled) setBrandingState(data || {});
      } catch {
        // Keep the shipped branding on any failure.
      }
    })();

    const onUpdate = (event) => setBrandingState(event?.detail || {});
    window.addEventListener(BRANDING_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(BRANDING_EVENT, onUpdate);
    };
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
