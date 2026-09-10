import { describe, it, expect } from "vitest";
import { reorderModelsByHealth } from "@/lib/modelHealth/sorter.js";

const info = (provider, model) => async (str) =>
  str === "ALIAS" ? { provider, model: "gpt-4o" } : { provider, model: str.split("/")[1] };

const readProvider = (map) => async (provider) => map[provider] || {};

const now = Date.now();
const fresh = (ttftMs, ok = true, fatal = false) => ({ ts: now - 1000, ok, ttftMs, fatal });

describe("reorderModelsByHealth", () => {
  it("moves slow and failing models to the tail, stable", async () => {
    // Realistic health rows: the sorter classifies from the event window at
    // read time, so fixtures carry the events that must drive each tag.
    const modelHealth = {
      openai: {
        "gpt-4o": {
          kind: "llm",
          // Baseline: many fast successes dominate the provider p50.
          events: Array.from({ length: 20 }, () => fresh(500)),
          lastPing: { at: now - 1000, ok: true, latencyMs: 500 },
          tag: "ok", tagComputedAt: now,
        },
        "gpt-slow": {
          kind: "llm",
          // 21s success vs provider p50 ≈ 1.5s (dominated by the fast
          // baseline): over 2x p50 AND over the 15s floor → slow.
          events: [fresh(21_000)],
          lastPing: null,
          tag: "slow", tagComputedAt: now,
        },
        "gpt-dead": {
          kind: "llm",
          // Two fatal events in the window → failing.
          events: [fresh(null, false, true), fresh(null, false, true)],
          lastPing: null,
          tag: "failing", tagComputedAt: now,
        },
      },
    };
    const deps = { getModelInfo: info("openai", ""), readProvider: readProvider(modelHealth) };
    const out = await reorderModelsByHealth(
      ["openai/gpt-4o", "openai/gpt-dead", "openai/gpt-slow", "openai/gpt-4o"],
      deps,
    );
    // dedupe never happens; relative order within ranks preserved
    expect(out[0]).toBe("openai/gpt-4o");
    expect(out[1]).toBe("openai/gpt-4o"); // second copy stays in rank 0
    expect(out).toContain("openai/gpt-slow");
    expect(out).toContain("openai/gpt-dead");
    expect(out.indexOf("openai/gpt-dead")).toBeGreaterThan(out.indexOf("openai/gpt-slow"));
  });

  it("resolves aliases through getModelInfo", async () => {
    const modelHealth = {
      openai: {
        "gpt-4o": {
          kind: "llm",
          // Two in-window fatal events → failing, so the aliased model is
          // deprioritized behind the healthy/unranked "openai/other".
          events: [fresh(null, false, true), fresh(null, false, true)],
          lastPing: null,
          tag: "failing", tagComputedAt: now,
        },
      },
    };
    const deps = { getModelInfo: info("openai", ""), readProvider: readProvider(modelHealth) };
    const out = await reorderModelsByHealth(["ALIAS", "openai/other"], deps);
    expect(out[0]).toBe("openai/other");
    expect(out[1]).toBe("ALIAS");
  });

  it("ignores a frozen stored tag: no in-window events → unknown, not deprioritized", async () => {
    // Stale row: the fatal events that once tagged this model `failing` have
    // aged out of the 1h window, but the persisted tag was never recomputed
    // (no further observations). Read-time classification must see UNKNOWN
    // and keep the model in rank 0 instead of trusting the frozen tag.
    const stale = now - 2 * 60 * 60 * 1000; // outside the 1h window
    const modelHealth = {
      openai: {
        "gpt-stale": {
          kind: "llm",
          events: [
            { ts: stale, ok: false, ttftMs: null, fatal: true },
            { ts: stale, ok: false, ttftMs: null, fatal: true },
          ],
          lastPing: null,
          tag: "failing", tagComputedAt: stale,
        },
        "gpt-4o": {
          kind: "llm",
          events: [fresh(500)],
          lastPing: null,
          tag: "ok", tagComputedAt: now,
        },
      },
    };
    const deps = { getModelInfo: info("openai", ""), readProvider: readProvider(modelHealth) };
    const out = await reorderModelsByHealth(["openai/gpt-stale", "openai/gpt-4o"], deps);
    // Stored `failing` would push gpt-stale to the tail; read-time classify
    // yields UNKNOWN → rank 0 → original order is preserved.
    expect(out).toEqual(["openai/gpt-stale", "openai/gpt-4o"]);
  });

  it("returns the list unchanged on empty health or errors", async () => {
    const deps = { getModelInfo: info("openai", ""), readProvider: readProvider({}) };
    const input = ["openai/a", "openai/b"];
    expect(await reorderModelsByHealth(input, deps)).toEqual(input);
    const broken = { getModelInfo: async () => { throw new Error("x"); }, readProvider: async () => { throw new Error("x"); } };
    expect(await reorderModelsByHealth(input, broken)).toEqual(input);
  });
});
