// Brand color math for the Personalization palette: one picked color is expanded
// into the full `--color-brand-50..900` scale (+ primary/primary-hover) so every
// existing `bg-primary` / `text-brand-500` / `border-brand-300` class keeps
// working. Pure: no DOM, no imports from src.

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeHex(input) {
  if (typeof input !== "string") return null;
  const value = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value.split("").map((c) => c + c).join("")}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value}`.toLowerCase();
  return null;
}

export function hexToHsl(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / delta) % 6; break;
      case g: h = (b - r) / delta + 2; break;
      default: h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;

  let rgb;
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

// Relative ladder: steps are placed around the picked color's own lightness so
// any hue (a near-white yellow or a deep blue) still yields a strictly darker
// sequence. `500` is always the exact picked color.
const LIGHT_STEPS = [
  { step: 50, up: 0.92, sat: 0.45 },
  { step: 100, up: 0.78, sat: 0.60 },
  { step: 200, up: 0.55, sat: 0.78 },
  { step: 300, up: 0.30, sat: 0.90 },
  { step: 400, up: 0.10, sat: 0.97 },
];
const DARK_STEPS = [
  { step: 600, down: 0.16, sat: 0.98 },
  { step: 700, down: 0.32, sat: 0.95 },
  { step: 800, down: 0.50, sat: 0.92 },
  { step: 900, down: 0.68, sat: 0.90 },
];
const LIGHT_CEILING = 98;
const DARK_FLOOR = 10;

/**
 * Expand one color into the CSS custom properties the theme consumes.
 * Returns null for invalid input so callers can keep the shipped palette.
 */
export function deriveBrandScale(hex) {
  const base = normalizeHex(hex);
  const hsl = base ? hexToHsl(base) : null;
  if (!hsl) return null;

  // Clamp the reference lightness: a pick at the extremes would otherwise squash
  // the whole ladder into a single shade.
  const baseL = clamp(hsl.l, 15, 92);
  const scale = { 500: base };

  for (const { step, up, sat } of LIGHT_STEPS) {
    scale[step] = hslToHex({
      h: hsl.h,
      s: hsl.s * sat,
      l: baseL + (LIGHT_CEILING - baseL) * up,
    });
  }
  for (const { step, down, sat } of DARK_STEPS) {
    scale[step] = hslToHex({
      h: hsl.h,
      s: hsl.s * sat,
      l: baseL - (baseL - DARK_FLOOR) * down,
    });
  }

  return {
    ...scale,
    primary: scale[500],
    primaryHover: scale[600],
    // Focus ring tint matches the previous rgba(229,106,74,0.18) pattern.
    focusShadow: `0 0 0 3px ${hexToRgba(scale[500], 0.18)}`,
  };
}

export function hexToRgba(hex, alpha = 1) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS custom properties to set on :root for a given picked color. */
export function brandingCssVars(hex) {
  const derived = deriveBrandScale(hex);
  if (!derived) return null;
  const vars = {};
  for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    vars[`--color-brand-${step}`] = derived[step];
  }
  vars["--color-primary"] = derived.primary;
  vars["--color-primary-hover"] = derived.primaryHover;
  vars["--shadow-focus"] = derived.focusShadow;
  vars["--shadow-warm"] = `0 2px 12px -2px ${hexToRgba(hex, 0.18)}`;
  return vars;
}
