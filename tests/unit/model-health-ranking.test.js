import { describe, it, expect } from "vitest";
import {
  reliabilityScore, recencyScore, speedScore, scoreEntry, rankEntries,
  RANKING_THRESHOLDS,
} from "../../src/lib/modelHealth/ranking.js";

const stats = (over = {}) => ({
  ok: 0, fail: 0, ttftSumMs: 0, ttftCount: 0, tpsSum: 0, tpsCount: 0,
  firstSeenAt: 1, lastOkAt: null, lastFailAt: null, ...over,
});

const entry = (model, over = {}) => ({
  provider: "openai", model, kind: "llm", tag: "ok", notServed: false,
  stats: stats(over), ...over.entry,
});

describe("reliabilityScore", () => {
  it("is neutral below minSamples and reflects the ratio above it", () => {
    expect(reliabilityScore(stats({ ok: 2, fail: 0 }))).toBe(0.5);
    expect(reliabilityScore(stats({ ok: 0, fail: 0 }))).toBe(0.5);
    expect(reliabilityScore(stats({ ok: 3, fail: 0 }))).toBe(1);
    expect(reliabilityScore(stats({ ok: 3, fail: 1 }))).toBe(0.75);
    expect(reliabilityScore(stats({ ok: 0, fail: 5 }))).toBe(0);
  });

  it("honours a custom minSamples", () => {
    expect(reliabilityScore(stats({ ok: 1, fail: 0 }), { ...RANKING_THRESHOLDS, minSamples: 1 })).toBe(1);
  });
});

describe("recencyScore", () => {
  it("is neutral without a success, halves every half-life, and floors at 0", () => {
    const now = 1_000_000_000;
    const halfLife = RANKING_THRESHOLDS.recencyHalfLifeMs;
    expect(recencyScore(null, now)).toBe(0.5);
    expect(recencyScore(now, now)).toBe(1);
    expect(recencyScore(now - halfLife, now)).toBe(0.5);
    expect(recencyScore(now - 20 * halfLife, now)).toBeLessThan(0.01);
  });
});

describe("speedScore", () => {
  const fast = entry("fast", { ok: 5, ttftSumMs: 500, ttftCount: 5, tpsSum: 500, tpsCount: 5 });
  const slow = entry("slow", { ok: 5, ttftSumMs: 5000, ttftCount: 5, tpsSum: 50, tpsCount: 5 });
  const cohort = [fast, slow];

  it("rewards lower ttft and higher tps within the cohort", () => {
    expect(speedScore(fast, cohort)).toBeGreaterThan(speedScore(slow, cohort));
    expect(speedScore(fast, cohort)).toBe(1);
    expect(speedScore(slow, cohort)).toBe(0);
  });

  it("is neutral without spread or without data", () => {
    const only = entry("only", { ok: 2, ttftSumMs: 100, ttftCount: 2 });
    expect(speedScore(only, [only])).toBe(0.5);
    expect(speedScore(entry("empty"), cohort)).toBe(0.5);
  });

  it("normalizes inside a kind cohort only", () => {
    const llm = entry("llm-a", { ok: 5, ttftSumMs: 1000, ttftCount: 5, lastOkAt: Date.now() });
    const tts = { ...entry("tts-a", { ok: 5, ttftSumMs: 9000, ttftCount: 5, lastOkAt: Date.now() }), kind: "tts" };

    // A slow tts model must not make an llm model look fast: each kind forms its
    // own cohort, and a single-member cohort is neutral.
    const ranked = rankEntries([llm, tts], { nowMs: Date.now() });
    expect(ranked.find((e) => e.model === "llm-a").rank.speed).toBe(0.5);
    expect(ranked.find((e) => e.model === "tts-a").rank.speed).toBe(0.5);
  });
});

describe("scoreEntry", () => {
  const now = Date.now();

  it("prefers the more reliable model when speed is equal", () => {
    const shared = { ttftSumMs: 1000, ttftCount: 10, tpsSum: 100, tpsCount: 10, lastOkAt: now };
    const reliable = entry("reliable", { ok: 10, fail: 0, ...shared });
    const flaky = entry("flaky", { ok: 9, fail: 1, ...shared });
    const cohort = [reliable, flaky];

    expect(scoreEntry(reliable, cohort, now).score).toBeGreaterThan(scoreEntry(flaky, cohort, now).score);
  });

  it("applies the configured weights (speed-first flips the order)", () => {
    const reliableSlow = entry("reliable-slow", { ok: 10, fail: 0, ttftSumMs: 9000, ttftCount: 10, lastOkAt: now });
    const flakyFast = entry("flaky-fast", { ok: 6, fail: 4, ttftSumMs: 100, ttftCount: 6, lastOkAt: now });
    const cohort = [reliableSlow, flakyFast];

    const balanced = rankEntries(cohort, { nowMs: now, weights: { reliability: 0, speed: 1, recency: 0 } });
    expect(balanced.map((e) => e.model)).toEqual(["flaky-fast", "reliable-slow"]);
  });
});

describe("rankEntries", () => {
  const now = Date.now();
  const good = entry("good", { ok: 10, fail: 0, ttftSumMs: 1000, ttftCount: 10, lastOkAt: now });
  const bad = entry("bad", { ok: 2, fail: 8, ttftSumMs: 1000, ttftCount: 2, lastOkAt: now });
  const failing = { ...entry("failing", { ok: 9, fail: 1, lastOkAt: now }), tag: "failing" };
  const notServed = { ...entry("not-served", { ok: 9, fail: 1, lastOkAt: now }), notServed: true };

  it("orders by score, with failing and not-served always last", () => {
    const ranked = rankEntries([failing, bad, notServed, good], { nowMs: now });
    expect(ranked.map((e) => e.model)).toEqual(["good", "bad", "failing", "not-served"]);
    expect(ranked[0].rank.score).toBeGreaterThan(ranked[1].rank.score);
    expect(ranked[2].rank.deprioritized).toBe(true);
    expect(ranked[3].rank.deprioritized).toBe(true);
  });

  it("is deterministic for equal scores", () => {
    const a = entry("alpha", { ok: 5, fail: 0, lastOkAt: now });
    const b = { ...entry("beta", { ok: 5, fail: 0, lastOkAt: now }), provider: "acme" };
    expect(rankEntries([b, a], { nowMs: now }).map((e) => e.model)).toEqual(["beta", "alpha"]);
    expect(rankEntries([a, b], { nowMs: now }).map((e) => e.model)).toEqual(["beta", "alpha"]);
  });

  it("treats missing stats as zero samples", () => {
    const unmeasured = { provider: "acme", model: "never-tested", kind: "llm", tag: "unknown", notServed: false, stats: null };
    const ranked = rankEntries([unmeasured, good], { nowMs: now });
    expect(ranked[0].model).toBe("good");
    expect(ranked[1].rank.samples).toBe(0);
  });
});
