// Internal health-probe marker shared by the sender (model pings) and the reader
// (the chat handler). Probes must not mutate account health state: a ping that
// fails for an account/quota reason would otherwise write a model lock and take
// that account's real traffic offline (see chat.js).
export const PROBE_HEADER = "x-9r-probe";

export function isProbeRequest(request) {
  try {
    return request?.headers?.get?.(PROBE_HEADER) === "1";
  } catch {
    return false;
  }
}
