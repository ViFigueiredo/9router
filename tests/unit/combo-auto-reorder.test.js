import { describe, it, expect, vi } from "vitest";
import { autoReorderCombos } from "../../src/lib/modelHealth/autoReorder.js";

const combos = [
  { id: "c1", name: "fast", models: ["a/low", "b/high", "c/mid"] },
  { id: "c2", name: "manual", models: ["a/low", "b/high"] },
];

const depsWith = (over = {}) => ({
  getCombos: async () => combos,
  updateCombo: vi.fn(async () => ({})),
  listComboOrdering: async () => ([]),
  buildGlobalRanking: async () => ({ scoreByModel: new Map([["a/low", 10], ["b/high", 90], ["c/mid", 50]]) }),
  ...over,
});

describe("autoReorderCombos", () => {
  it("reorders only combos that opted in", async () => {
    const updateCombo = vi.fn(async () => ({}));
    const res = await autoReorderCombos(depsWith({
      updateCombo,
      listComboOrdering: async () => ([
        { comboName: "fast", lockedModels: [], autoReorder: true },
        { comboName: "manual", lockedModels: [], autoReorder: false },
      ]),
    }));

    expect(res.reordered).toEqual(["fast"]);
    expect(updateCombo).toHaveBeenCalledTimes(1);
    expect(updateCombo).toHaveBeenCalledWith("c1", { models: ["b/high", "c/mid", "a/low"] });
  });

  it("keeps locked models at their index and leaves unscored models last", async () => {
    const updateCombo = vi.fn(async () => ({}));
    await autoReorderCombos(depsWith({
      updateCombo,
      getCombos: async () => ([{ id: "c3", name: "locked", models: ["a/low", "z/unmeasured", "b/high"] }]),
      listComboOrdering: async () => ([{ comboName: "locked", lockedModels: ["a/low"], autoReorder: true }]),
    }));

    expect(updateCombo).toHaveBeenCalledWith("c3", { models: ["a/low", "b/high", "z/unmeasured"] });
  });

  it("does not write when the order is already correct", async () => {
    const updateCombo = vi.fn(async () => ({}));
    const res = await autoReorderCombos(depsWith({
      updateCombo,
      getCombos: async () => ([{ id: "c4", name: "sorted", models: ["b/high", "c/mid", "a/low"] }]),
      listComboOrdering: async () => ([{ comboName: "sorted", lockedModels: [], autoReorder: true }]),
    }));

    expect(res.reordered).toEqual([]);
    expect(updateCombo).not.toHaveBeenCalled();
  });

  it("skips combos that no longer exist and never throws", async () => {
    const updateCombo = vi.fn(async () => ({}));
    const res = await autoReorderCombos(depsWith({
      updateCombo,
      listComboOrdering: async () => ([{ comboName: "deleted", lockedModels: [], autoReorder: true }]),
    }));
    expect(res.reordered).toEqual([]);
    expect(updateCombo).not.toHaveBeenCalled();

    const broken = await autoReorderCombos(depsWith({
      listComboOrdering: async () => { throw new Error("db down"); },
    }));
    expect(broken.reordered).toEqual([]);
  });
});
