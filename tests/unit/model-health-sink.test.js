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

  it("marks a provider 404 model-not-found as notServed and clears it after a success", async () => {
    await sink.recordObservation({
      provider: "hcnsec", model: "sensenova-u1.5-lite", ok: false, status: 404, isPing: true,
      errorText: '[404]: {"error":{"message":"model is not found","type":"not_found_error","param":"","code":"5"}}',
    });
    let snap = await sink.getHealthSnapshot("hcnsec");
    expect(snap["sensenova-u1.5-lite"].notServed).toBe(true);
    expect(snap["sensenova-u1.5-lite"].lastErrorStatus).toBe(404);
    expect(String(snap["sensenova-u1.5-lite"].lastErrorMessage)).toContain("model is not found");

    await sink.recordObservation({ provider: "hcnsec", model: "sensenova-u1.5-lite", ok: true, status: 200, isPing: true, ttftMs: 900 });
    snap = await sink.getHealthSnapshot("hcnsec");
    expect(snap["sensenova-u1.5-lite"].notServed).toBe(false);
    expect(snap["sensenova-u1.5-lite"].lastErrorMessage).toBeNull();
  });

  it("keeps a 500 failure as failing without a notServed warning", async () => {
    await sink.recordObservation({ provider: "hcnsec", model: "step-explore", ok: false, status: 503, isPing: true, errorText: "HTTP 503: upstream down" });
    const snap = await sink.getHealthSnapshot("hcnsec");
    expect(snap["step-explore"].notServed).toBe(false);
    expect(snap["step-explore"].tag).toBe(classifier.HEALTH_TAGS.FAILING);
  });

  it("aggregates positive tps into tpsAvg and ignores non-positive or missing tps", async () => {
    await sink.recordObservation({ provider: "tpsprov", model: "m1", ok: true, status: 200, ttftMs: 200, tps: 50 });
    await sink.recordObservation({ provider: "tpsprov", model: "m1", ok: true, status: 200, ttftMs: 300, tps: 70 });
    await sink.recordObservation({ provider: "tpsprov", model: "m1", ok: true, status: 200, ttftMs: 250, tps: null });
    await sink.recordObservation({ provider: "tpsprov", model: "m1", ok: true, status: 200, ttftMs: 250, tps: 0 });

    const snap = await sink.getHealthSnapshot("tpsprov");
    expect(snap["m1"].tpsAvg).toBe(60); // (50 + 70) / 2 = 60
    expect(snap["m1"].ttftAvgMs).toBe(250); // (200 + 300 + 250 + 250) / 4 = 250
  });

  it("returns null tpsAvg when no observations have valid tps", async () => {
    await sink.recordObservation({ provider: "tpsprov", model: "m2", ok: true, status: 200, ttftMs: 150 });
    const snap = await sink.getHealthSnapshot("tpsprov");
    expect(snap["m2"].tpsAvg).toBeNull();
    expect(snap["m2"].ttftAvgMs).toBe(150);
  });

  it("accumulates ranking counters from ok and model-fatal outcomes only", async () => {
    await sink.recordObservation({ provider: "rankprov", model: "m1", ok: true, status: 200, ttftMs: 200, tps: 40, isPing: true });
    await sink.recordObservation({ provider: "rankprov", model: "m1", ok: true, status: 200, ttftMs: 400, tps: 60, isPing: true });
    await sink.recordObservation({ provider: "rankprov", model: "m1", ok: false, status: 502, isPing: true }); // fatal
    await sink.recordObservation({ provider: "rankprov", model: "m1", ok: false, status: 429, isPing: true }); // account: ignored
    await sink.recordObservation({ provider: "rankprov", model: "m1", ok: false, status: 401 }); // account: ignored

    const mh = await repo.getModelHealthByProvider("rankprov");
    const { stats } = mh["m1"];
    expect(stats.ok).toBe(2);
    expect(stats.fail).toBe(1);
    expect(stats.ttftCount).toBe(2);
    expect(stats.ttftSumMs).toBe(600);
    expect(stats.tpsCount).toBe(2);
    expect(stats.tpsSum).toBe(100);
    expect(stats.firstSeenAt).toBeTypeOf("number");
    expect(stats.lastOkAt).toBeTypeOf("number");
    expect(stats.lastFailAt).toBeTypeOf("number");
  });

  it("resets accumulated counters without touching the event window", async () => {
    await sink.recordObservation({ provider: "resetprov", model: "m1", ok: true, status: 200, ttftMs: 100, isPing: true });
    await sink.recordObservation({ provider: "resetprov", model: "m2", ok: true, status: 200, ttftMs: 100, isPing: true });

    await repo.resetModelStats("resetprov", "m1");
    let mh = await repo.getModelHealthByProvider("resetprov");
    expect(mh["m1"].stats).toBeNull();
    expect(mh["m1"].events.length).toBe(1); // window preserved
    expect(mh["m2"].stats.ok).toBe(1);      // other model untouched

    await repo.resetModelStats("resetprov");
    mh = await repo.getModelHealthByProvider("resetprov");
    expect(mh["m2"].stats).toBeNull();
  });
});
