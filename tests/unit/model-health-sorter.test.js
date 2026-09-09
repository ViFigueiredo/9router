import { describe, it, expect } from "vitest";
import { reorderModelsByHealth } from "@/lib/modelHealth/sorter.js";

const info = (provider, model) => async (str) =>
  str === "ALIAS" ? { provider, model: "gpt-4o" } : { provider, model: str.split("/")[1] };

const readProvider = (map) => async (provider) => map[provider] || {};

describe("reorderModelsByHealth", () => {
  it("moves slow and failing models to the tail, stable", async () => {
    const modelHealth = {
      openai: {
        "gpt-4o": { kind: "llm", events: [], lastPing: { at: Date.now() - 1000, ok: true, latencyMs: 500 }, tag: "ok", tagComputedAt: Date.now() },
        "gpt-slow": { kind: "llm", events: [], lastPing: null, tag: "slow", tagComputedAt: Date.now() },
        "gpt-dead": { kind: "llm", events: [], lastPing: null, tag: "failing", tagComputedAt: Date.now() },
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
        "gpt-4o": { kind: "llm", events: [], lastPing: null, tag: "failing", tagComputedAt: Date.now() },
      },
    };
    const deps = { getModelInfo: info("openai", ""), readProvider: readProvider(modelHealth) };
    const out = await reorderModelsByHealth(["ALIAS", "openai/other"], deps);
    expect(out[0]).toBe("openai/other");
    expect(out[1]).toBe("ALIAS");
  });

  it("returns the list unchanged on empty health or errors", async () => {
    const deps = { getModelInfo: info("openai", ""), readProvider: readProvider({}) };
    const input = ["openai/a", "openai/b"];
    expect(await reorderModelsByHealth(input, deps)).toEqual(input);
    const broken = { getModelInfo: async () => { throw new Error("x"); }, readProvider: async () => { throw new Error("x"); } };
    expect(await reorderModelsByHealth(input, broken)).toEqual(input);
  });
});
