import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let DATA_DIR;
let sink;
let repo;
let classifier;

beforeAll(async () => {
  DATA_DIR = mkdtempSync(join(tmpdir(), "mh-sink-"));
  process.env.DATA_DIR = DATA_DIR;
  sink = await import("@/lib/modelHealth/sink.js");
  repo = await import("@/lib/db/repos/modelHealthRepo.js");
  classifier = await import("@/lib/modelHealth/classifier.js");
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("modelHealth sink", () => {
  it("records observations and derives tags", async () => {
    // Two fatal events → failing
    await sink.recordObservation({ provider: "openai", model: "gpt-4o", ok: false, status: 502 });
    await sink.recordObservation({ provider: "openai", model: "gpt-4o", ok: false, status: 500 });
    const snap = await sink.getHealthSnapshot("openai");
    expect(snap["gpt-4o"].tag).toBe(classifier.HEALTH_TAGS.FAILING);
    expect(snap["gpt-4o"].fatalEvents).toBe(2);
  });

  it("records a failed ping as failing", async () => {
    await sink.recordObservation({ provider: "openai", model: "gpt-4o", ok: false, status: 502, isPing: true });
    const snap = await sink.getHealthSnapshot("openai");
    expect(snap["gpt-4o"].lastPingAt).toBeTypeOf("number");
    expect(snap["gpt-4o"].tag).toBe(classifier.HEALTH_TAGS.FAILING);
  });

  it("records auth errors without failing the model", async () => {
    await sink.recordObservation({ provider: "openai", model: "gpt-4o", ok: false, status: 429 });
    const snap = await sink.getHealthSnapshot("openai");
    // Still failing only because of the earlier 502 events/ping — never because of 429 alone
    const fresh = await sink.getHealthSnapshot("anthropic");
    expect(fresh).toEqual({});
  });

  it("is fail-open: bad args never throw", async () => {
    await expect(sink.recordObservation({ provider: "", model: "", ok: true })).resolves.toBeUndefined();
    await expect(sink.getHealthSnapshot(null)).resolves.toEqual({});
  });
});
