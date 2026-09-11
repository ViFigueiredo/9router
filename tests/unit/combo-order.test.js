import { describe, it, expect } from "vitest";
import { reorderComboModels, reorderByRank, orderChanged } from "../../src/lib/modelHealth/comboOrder.js";

const models = ["a/one", "b/two", "c/three", "d/four"];
const score = (entries) => new Map(entries);

describe("reorderComboModels", () => {
  it("orders by descending score", () => {
    const out = reorderComboModels(models, {
      scoreByModel: score([["a/one", 10], ["b/two", 90], ["c/three", 50], ["d/four", 20]]),
    });
    expect(out).toEqual(["b/two", "c/three", "d/four", "a/one"]);
  });

  it("keeps locked models at their absolute index", () => {
    const out = reorderComboModels(models, {
      locked: ["a/one", "c/three"],
      scoreByModel: score([["a/one", 1], ["b/two", 90], ["c/three", 2], ["d/four", 20]]),
    });
    // index 0 and 2 stay; the remaining slots get the movable models by score.
    expect(out).toEqual(["a/one", "b/two", "c/three", "d/four"]);
    expect(out[0]).toBe("a/one");
    expect(out[2]).toBe("c/three");
  });

  it("is a no-op when everything is locked or nothing is scored differently", () => {
    expect(reorderComboModels(models, { locked: models, scoreByModel: score([["a/one", 0]]) })).toEqual(models);
    expect(reorderComboModels(models, {})).toEqual(models);
    expect(reorderComboModels(models, { scoreByModel: score(models.map((m) => [m, 5])) })).toEqual(models);
  });

  it("is stable for equal scores", () => {
    const out = reorderComboModels(["x/1", "y/2", "z/3"], {
      scoreByModel: score([["x/1", 5], ["y/2", 5], ["z/3", 5]]),
    });
    expect(out).toEqual(["x/1", "y/2", "z/3"]);
  });

  it("handles unscored models with the configured fallback score", () => {
    const out = reorderComboModels(models, {
      scoreByModel: score([["a/one", 50]]),
      unscoredScore: 100,
    });
    expect(out[0]).toBe("b/two");
    expect(out[3]).toBe("a/one");
  });

  it("never changes length or membership", () => {
    const out = reorderComboModels(models, { locked: ["d/four"], scoreByModel: score([["c/three", 99]]) });
    expect(out.length).toBe(models.length);
    expect([...out].sort()).toEqual([...models].sort());
  });

  it("returns a copy for degenerate inputs", () => {
    expect(reorderComboModels([], {})).toEqual([]);
    expect(reorderComboModels(["only/one"], {})).toEqual(["only/one"]);
    expect(reorderComboModels(null, {})).toEqual([]);
  });
});

describe("reorderByRank", () => {
  it("maps lower rank numbers to earlier positions and honours locks", () => {
    const out = reorderByRank(models, {
      rankByModel: new Map([["a/one", 4], ["b/two", 1], ["c/three", 3], ["d/four", 2]]),
      maxRank: 4,
    });
    expect(out).toEqual(["b/two", "d/four", "c/three", "a/one"]);

    const lockedOut = reorderByRank(models, {
      locked: ["a/one"],
      rankByModel: new Map([["a/one", 4], ["b/two", 1], ["c/three", 3], ["d/four", 2]]),
      maxRank: 4,
    });
    expect(lockedOut[0]).toBe("a/one");
    expect(lockedOut.slice(1)).toEqual(["b/two", "d/four", "c/three"]);
  });
});

describe("orderChanged", () => {
  it("detects real changes only", () => {
    expect(orderChanged(["a", "b"], ["a", "b"])).toBe(false);
    expect(orderChanged(["a", "b"], ["b", "a"])).toBe(true);
    expect(orderChanged(["a"], ["a", "b"])).toBe(true);
  });
});
