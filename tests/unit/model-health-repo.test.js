import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the DB from the real ~/.9router before any adapter init.
let DATA_DIR;
let repo;

beforeAll(async () => {
  DATA_DIR = mkdtempSync(join(tmpdir(), "mh-repo-"));
  process.env.DATA_DIR = DATA_DIR;
  repo = await import("@/lib/db/repos/modelHealthRepo.js");
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("modelHealthRepo", () => {
  it("returns {} for unknown provider", async () => {
    const map = await repo.getModelHealthByProvider("openai");
    expect(map).toEqual({});
  });

  it("upserts, updates and deletes model entries atomically", async () => {
    await repo.updateModelHealth("openai", "gpt-4o", (prev) => ({
      kind: "llm",
      events: [{ ts: 1, ok: true, ttftMs: 100, fatal: false }],
      lastPing: null,
      tag: "unknown",
      tagComputedAt: null,
    }));
    let map = await repo.getModelHealthByProvider("openai");
    expect(map["gpt-4o"].kind).toBe("llm");

    await repo.updateModelHealth("openai", "gpt-4o", (prev) => ({
      ...prev,
      events: [...prev.events, { ts: 2, ok: false, ttftMs: null, fatal: true }],
    }));
    map = await repo.getModelHealthByProvider("openai");
    expect(map["gpt-4o"].events).toHaveLength(2);

    await repo.updateModelHealth("openai", "gpt-4o", () => null);
    map = await repo.getModelHealthByProvider("openai");
    expect(map["gpt-4o"]).toBeUndefined();
  });

  it("returns all providers via getModelHealth", async () => {
    await repo.updateModelHealth("anthropic", "claude-3-opus", (prev) => ({
      kind: "llm",
      events: [],
      lastPing: null,
      tag: "unknown",
      tagComputedAt: null,
    }));
    const all = await repo.getModelHealth();
    expect(all.anthropic["claude-3-opus"]).toBeTruthy();
  });
});
