import { describe, it, expect } from "vitest";
import { normalizeHex, hexToHsl, hslToHex, deriveBrandScale, brandingCssVars, hexToRgba } from "../../src/shared/utils/brandColor.js";

describe("normalizeHex", () => {
  it("accepts 3/6 digit hex with or without #", () => {
    expect(normalizeHex("#E56A4A")).toBe("#e56a4a");
    expect(normalizeHex("e56a4a")).toBe("#e56a4a");
    expect(normalizeHex("#fff")).toBe("#ffffff");
  });

  it("rejects anything else", () => {
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("hsl round trip", () => {
  it("returns the original color for known values", () => {
    const hsl = hexToHsl("#e56a4a");
    expect(hsl.h).toBeCloseTo(12, 0);
    expect(hslToHex(hsl)).toBe("#e56a4a");
  });

  it("round-trips greys with zero saturation", () => {
    expect(hslToHex(hexToHsl("#808080"))).toBe("#808080");
  });
});

describe("deriveBrandScale", () => {
  const scale = deriveBrandScale("#3b82f6");

  it("keeps the picked color at 500 and derives hover from 600", () => {
    expect(scale[500]).toBe("#3b82f6");
    expect(scale.primary).toBe("#3b82f6");
    expect(scale.primaryHover).toBe(scale[600]);
    expect(scale.primaryHover).not.toBe(scale.primary);
  });

  it("produces a monotonically darker ladder", () => {
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    const lightness = steps.map((s) => hexToHsl(scale[s]).l);
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i]).toBeLessThan(lightness[i - 1]);
    }
  });

  it("preserves hue across the ladder", () => {
    const baseHue = hexToHsl("#3b82f6").h;
    for (const step of [100, 300, 500, 700, 900]) {
      expect(Math.abs(hexToHsl(scale[step]).h - baseHue)).toBeLessThan(2);
    }
  });

  it("returns null for invalid input", () => {
    expect(deriveBrandScale("nope")).toBeNull();
    expect(deriveBrandScale(undefined)).toBeNull();
  });
});

describe("brandingCssVars", () => {
  it("emits every variable the theme consumes", () => {
    const vars = brandingCssVars("#10b981");
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(vars[`--color-brand-${step}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(vars["--color-primary"]).toBe("#10b981");
    expect(vars["--color-primary-hover"]).toBeTruthy();
    expect(vars["--shadow-focus"]).toContain("rgba(16, 185, 129, 0.18)");
  });

  it("returns null when the color is unusable", () => {
    expect(brandingCssVars("")).toBeNull();
  });
});

describe("hexToRgba", () => {
  it("builds an rgba string", () => {
    expect(hexToRgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(hexToRgba("zzz")).toBeNull();
    expect(hexToRgba("")).toBeNull();
  });
});
