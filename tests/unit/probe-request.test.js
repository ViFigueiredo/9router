import { describe, it, expect } from "vitest";
import { PROBE_HEADER, isProbeRequest } from "../../src/sse/services/probeRequest.js";

const reqWith = (value) => ({ headers: { get: (name) => (name === PROBE_HEADER ? value : null) } });

describe("isProbeRequest", () => {
  it("recognizes the probe marker on the request", () => {
    expect(isProbeRequest(reqWith("1"))).toBe(true);
  });

  it("treats normal traffic as non-probe", () => {
    expect(isProbeRequest(reqWith(null))).toBe(false);
    expect(isProbeRequest(reqWith("0"))).toBe(false);
  });

  it("never throws on requests without headers", () => {
    expect(isProbeRequest(null)).toBe(false);
    expect(isProbeRequest({})).toBe(false);
    expect(isProbeRequest({ headers: {} })).toBe(false);
  });
});
