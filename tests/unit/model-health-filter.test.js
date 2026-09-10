import { describe, it, expect } from "vitest";
import {
  filterModelRows, healthTagOf, HEALTH_FILTER_ALL, HEALTH_FILTER_UNKNOWN,
} from "@/shared/utils/modelHealthFilter.js";

const rows = [
  { id: "gpt-4o" },
  { id: "gpt-4o-mini", name: "Fast Mini" },
  { id: "claude-opus" },
  { id: "am/deepseek-v4-flash" },
];

const health = {
  "gpt-4o": { tag: "ok" },
  "gpt-4o-mini": { tag: "slow" },
  "claude-opus": { tag: "failing" },
  // am/deepseek-v4-flash has no entry → unknown
};

describe("filterModelRows", () => {
  it("returns all rows for empty query and all tag", () => {
    expect(filterModelRows(rows, { healthByModel: health })).toHaveLength(4);
  });

  it("filters by id substring, case-insensitive", () => {
    const out = filterModelRows(rows, { query: "GPT-4O", healthByModel: health });
    expect(out.map((r) => r.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("matches the display name too", () => {
    const out = filterModelRows(rows, { query: "fast mini", healthByModel: health });
    expect(out.map((r) => r.id)).toEqual(["gpt-4o-mini"]);
  });

  it("filters by health tag, treating missing entries as unknown", () => {
    expect(filterModelRows(rows, { tag: "failing", healthByModel: health }).map((r) => r.id)).toEqual(["claude-opus"]);
    expect(filterModelRows(rows, { tag: "unknown", healthByModel: health }).map((r) => r.id)).toEqual(["am/deepseek-v4-flash"]);
  });

  it("combines query and tag", () => {
    expect(filterModelRows(rows, { query: "gpt", tag: "slow", healthByModel: health }).map((r) => r.id)).toEqual(["gpt-4o-mini"]);
  });

  it("is safe with bad input", () => {
    expect(filterModelRows(null, {})).toEqual([]);
    expect(healthTagOf({}, "x")).toBe(HEALTH_FILTER_UNKNOWN);
    expect(HEALTH_FILTER_ALL).toBe("all");
  });
});
