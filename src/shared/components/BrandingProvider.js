"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { brandingCssVars } from "@/shared/utils/brandColor";

export const DEFAULT_TITLE = "9Router - AI Infrastructure Management";
export const DEFAULT_FAVICON = "/favicon.svg";
// Fired by the settings page after saving so the change applies without a reload.
export const BRANDING_EVENT = "9r:branding-updated";

const CSS_VAR_KEYS = [
  ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => `--color-brand-${s}`),
  "--color-primary",
  "--color-primary-hover",
  "--shadow-focus",
  "--shadow-warm",
];

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
  const { appName = "", faviconDataUrl = "", primaryColor = "" } = branding || {};
  const root = document.documentElement;

  const vars = primaryColor ? brandingCssVars(primaryColor) : null;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  } else {
    // Back to the shipped palette: drop the overrides, keep the stylesheet values.
    for (const key of CSS_VAR_KEYS) root.style.removeProperty(key);
  }

  const name = String(appName).trim();
  document.title = name ? `${name} - AI Infrastructure Management` : DEFAULT_TITLE;

  const href = faviconDataUrl || DEFAULT_FAVICON;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "icon");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        const data = res.ok ? await res.json() : {};
        if (!cancelled) setBrandingState(data.branding || {});
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
