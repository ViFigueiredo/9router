import { describe, it, expect } from "vitest";
import {
  HEALTH_TAGS, isFatalEvent, isModelNotServed, pruneEvents, providerP50, classify,
} from "@/lib/modelHealth/classifier.js";

const NOW = 1_000_000_000_000;

const ev = (ts, ok, ttftMs, fatal) => ({ ts, ok, ttftMs, fatal });

describe("isFatalEvent", () => {
  it("treats model-level and server errors as fatal", () => {
    expect(isFatalEvent({ ok: false, status: 404 })).toBe(true);
    expect(isFatalEvent({ ok: false, status: 499 })).toBe(true);
    expect(isFatalEvent({ ok: false, status: 500 })).toBe(true);
    expect(isFatalEvent({ ok: false, status: 502 })).toBe(true);
    expect(isFatalEvent({ ok: false, status: null })).toBe(true);
  });
  it("excludes auth/quota/rate errors (account-level)", () => {
    expect(isFatalEvent({ ok: false, status: 401 })).toBe(false);
    expect(isFatalEvent({ ok: false, status: 403 })).toBe(false);
    expect(isFatalEvent({ ok: false, status: 429 })).toBe(false);
  });
  it("successes are never fatal", () => {
    expect(isFatalEvent({ ok: true, status: 200 })).toBe(false);
  });
});

describe("isModelNotServed", () => {
  it("detects provider 404 model-not-found envelopes", () => {
    expect(isModelNotServed({ status: 404, message: '[404]: {"error":{"message":"model is not found","type":"not_found_error","param":"","code":"5"}}' })).toBe(true);
    expect(isModelNotServed({ status: 404, message: "Model am/minimax-m3 was retired by its provider on 2026-09-09 and is no longer served." })).toBe(true);
    expect(isModelNotServed({ status: 404, message: "code=model_not_found" })).toBe(true);
  });

  it("does not fire for other statuses or unrelated messages", () => {
    expect(isModelNotServed({ status: 500, message: "model is not found" })).toBe(false);
    expect(isModelNotServed({ status: 404, message: "route not found" })).toBe(false);
    expect(isModelNotServed({ status: null, message: "" })).toBe(false);
    expect(isModelNotServed({})).toBe(false);
  });
});

describe("pruneEvents", () => {
  it("drops events outside the 1h window and caps at maxEvents", () => {
    const old = ev(NOW - 3_700_000, true, 100, false);
    const fresh = ev(NOW - 1000, true, 100, false);
    expect(pruneEvents([old, fresh], NOW, 3_600_000)).toEqual([fresh]);
  });
});

describe("providerP50", () => {
  it("averages successful ttft samples of the given kind", () => {
    const map = {
      a: { kind: "llm", events: [ev(NOW - 1000, true, 100, false), ev(NOW - 500, true, 300, false)] },
      b: { kind: "tts", events: [ev(NOW - 1000, true, 900, false)] },
      c: { kind: "llm", events: [ev(NOW - 1000, false, null, true)] },
    };
    expect(providerP50(map, "llm", NOW)).toBe(200);
  });
});

describe("classify", () => {
  it("returns failing with 2+ fatal events in the window", () => {
    const events = [
      ev(NOW - 1000, false, null, true),
      ev(NOW - 500, false, null, true),
    ];
    expect(classify({ events, lastPing: null, providerP50Ms: 1000, now: NOW }).tag)
      .toBe(HEALTH_TAGS.FAILING);
  });
  it("returns failing when the latest ping failed within the window", () => {
    const lastPing = { at: NOW - 1000, ok: false, latencyMs: 5000 };
    expect(classify({ events: [], lastPing, providerP50Ms: 1000, now: NOW }).tag)
      .toBe(HEALTH_TAGS.FAILING);
  });
  it("returns slow only above both relative multiplier and absolute floor", () => {
    // provider p50 10s → model 21s: over 2x AND over 15s floor
    const slow = { events: [ev(NOW - 1000, true, 21_000, false)], lastPing: null, providerP50Ms: 10_000, now: NOW };
    expect(classify(slow).tag).toBe(HEALTH_TAGS.SLOW);
    // provider p50 8s → model 14s: under 15s absolute floor → ok
    const ok = { events: [ev(NOW - 1000, true, 14_000, false)], lastPing: null, providerP50Ms: 8_000, now: NOW };
    expect(classify(ok).tag).toBe(HEALTH_TAGS.OK);
    // provider p50 2s → model 3s: over floor but under 2x → ok
    const ok2 = { events: [ev(NOW - 1000, true, 3_000, false)], lastPing: null, providerP50Ms: 2_000, now: NOW };
    expect(classify(ok2).tag).toBe(HEALTH_TAGS.OK);
  });
  it("returns ok for healthy recent traffic and unknown for no data", () => {
    const ok = { events: [ev(NOW - 1000, true, 500, false)], lastPing: null, providerP50Ms: 500, now: NOW };
    expect(classify(ok).tag).toBe(HEALTH_TAGS.OK);
    expect(classify({ events: [], lastPing: null, providerP50Ms: null, now: NOW }).tag)
      .toBe(HEALTH_TAGS.UNKNOWN);
  });

  it("recovers from failing when a success is newer than the fatal errors", () => {
    const events = [
      ev(NOW - 3000, false, null, true),
      ev(NOW - 2000, false, null, true),
      ev(NOW - 1000, true, 500, false),
    ];
    expect(classify({ events, lastPing: null, providerP50Ms: 500, now: NOW }).tag)
      .toBe(HEALTH_TAGS.OK);
  });

  it("stays failing when the fatal errors are newer than the last success", () => {
    const events = [
      ev(NOW - 2000, true, 500, false),
      ev(NOW - 1000, false, null, true),
      ev(NOW - 500, false, null, true),
    ];
    expect(classify({ events, lastPing: null, providerP50Ms: 500, now: NOW }).tag)
      .toBe(HEALTH_TAGS.FAILING);
  });
});
