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

  it("keeps prior lastPing on account-level ping failure (429), fatal pings still fail", async () => {
    // Fresh provider+model: account-level 429 ping must not create a failing lastPing.
    await sink.recordObservation({ provider: "edge", model: "edge-1", ok: false, status: 429, isPing: true });
    let snap = await sink.getHealthSnapshot("edge");
    expect(snap["edge-1"].tag).not.toBe(classifier.HEALTH_TAGS.FAILING);
    expect(snap["edge-1"].lastPingAt).toBeNull();

    // An ok ping followed by a model-fatal 404 ping still tags the model failing.
    await sink.recordObservation({ provider: "edge", model: "edge-1", ok: true, isPing: true });
    await sink.recordObservation({ provider: "edge", model: "edge-1", ok: false, status: 404, isPing: true });
    snap = await sink.getHealthSnapshot("edge");
    expect(snap["edge-1"].lastPingAt).toBeTypeOf("number");
    expect(snap["edge-1"].tag).toBe(classifier.HEALTH_TAGS.FAILING);
  });

  it("records auth errors without failing the model", async () => {
    await sink.recordObservation({ provider: "openai", model: "gpt-4o", ok: false, status: 429 });
    const snap = await sink.getHealthSnapshot("openai");
    // Still failing only because of the earlier 502 events/ping — never because of 429 alone
    const fresh = await sink.getHealthSnapshot("anthropic");
    expect(fresh).toEqual({});
  });

  it("does not record a lone 429 ping as health activity (stays unknown, no events, no lastPing)", async () => {
    await sink.recordObservation({ provider: "edge429", model: "edge-429", ok: false, status: 429, isPing: true });
    const snap = await sink.getHealthSnapshot("edge429");
    expect(snap["edge-429"].tag).toBe(classifier.HEALTH_TAGS.UNKNOWN);
    expect(snap["edge-429"].totalEvents).toBe(0);
    expect(snap["edge-429"].lastPingAt).toBeNull();
  });

  it("does not record a lone 401 as health activity (stays unknown, no events)", async () => {
    await sink.recordObservation({ provider: "edge401", model: "edge-401", ok: false, status: 401 });
    const snap = await sink.getHealthSnapshot("edge401");
    expect(snap["edge-401"].tag).toBe(classifier.HEALTH_TAGS.UNKNOWN);
    expect(snap["edge-401"].totalEvents).toBe(0);
  });

  it("is fail-open: bad args never throw", async () => {
    await expect(sink.recordObservation({ provider: "", model: "", ok: true })).resolves.toBeUndefined();
    await expect(sink.getHealthSnapshot(null)).resolves.toEqual({});
  });
});
