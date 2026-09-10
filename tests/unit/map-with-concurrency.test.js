import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "@/shared/utils/mapWithConcurrency.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("maps every item and preserves input order", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      await sleep(n * 5);
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("never exceeds the in-flight limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(10);
      inFlight -= 1;
      return true;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty input and a single item", async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([7], 3, async (n) => n + 1)).toEqual([8]);
    expect(await mapWithConcurrency(null, 2, async () => 1)).toEqual([]);
  });
});
