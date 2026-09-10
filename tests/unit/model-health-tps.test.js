import { describe, it, expect, vi } from "vitest";
import { buildOnStreamComplete } from "open-sse/handlers/chatCore/streamingHandler.js";
import { handleNonStreamingResponse } from "open-sse/handlers/chatCore/nonStreamingHandler.js";

describe("model-health TPS calculation", () => {
  it("computes generation TPS from post-TTFT window in streaming", () => {
    const observations = [];
    const requestStartTime = 1000;
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "openai",
      model: "gpt-4o",
      body: { messages: [] },
      requestStartTime,
      onModelObservation: (obs) => observations.push(obs),
    });
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(3000); // totalMs = 2000ms

    // ttftAt = 1500 -> ttftMs = 500ms
    // genMs = 2000 - 500 = 1500ms
    // completion_tokens = 75
    // genTps = round(75 * 1000 / 1500) = 50
    onStreamComplete(
      { content: "hello world" },
      { prompt_tokens: 10, completion_tokens: 75 },
      1500
    );

    dateSpy.mockRestore();

    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual({
      provider: "openai",
      model: "gpt-4o",
      kind: "llm",
      ok: true,
      status: 200,
      ttftMs: 500,
      totalMs: 2000,
      tps: 50,
    });
  });

  it("supports output_tokens format (e.g. Claude) in streaming", () => {
    const observations = [];
    const requestStartTime = 1000;
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      body: { messages: [] },
      requestStartTime,
      onModelObservation: (obs) => observations.push(obs),
    });

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(2000); // totalMs = 1000ms

    // ttftAt = 1200 -> ttftMs = 200ms -> genMs = 800ms
    // output_tokens = 40 -> tps = round(40 * 1000 / 800) = 50
    onStreamComplete(
      { content: "test" },
      { input_tokens: 20, output_tokens: 40 },
      1200
    );

    dateSpy.mockRestore();

    expect(observations).toHaveLength(1);
    expect(observations[0].tps).toBe(50);
    expect(observations[0].ttftMs).toBe(200);
  });

  it("returns null TPS when completion tokens are zero or missing", () => {
    const observations = [];
    const requestStartTime = 1000;
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "openai",
      model: "gpt-4o",
      body: { messages: [] },
      requestStartTime,
      onModelObservation: (obs) => observations.push(obs),
    });
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(2000);

    onStreamComplete({ content: "" }, { prompt_tokens: 10, completion_tokens: 0 }, 1500);

    dateSpy.mockRestore();

    expect(observations).toHaveLength(1);
    expect(observations[0].tps).toBeNull();
  });

  it("returns null TPS when genMs is non-positive", () => {
    const observations = [];
    const requestStartTime = 1000;
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "openai",
      model: "gpt-4o",
      body: { messages: [] },
      requestStartTime,
      onModelObservation: (obs) => observations.push(obs),
    });

    // Date.now() returns same as ttftAt
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1500);

    onStreamComplete({ content: "quick" }, { completion_tokens: 10 }, 1500);

    dateSpy.mockRestore();

    expect(observations).toHaveLength(1);
    expect(observations[0].tps).toBeNull();
  });

  it("returns usage in handleNonStreamingResponse for TPS calculation", async () => {
    const providerResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: "hello world" } }],
        usage: { prompt_tokens: 15, completion_tokens: 60, total_tokens: 75 },
      }),
      { headers: { "content-type": "application/json" } }
    );

    const result = await handleNonStreamingResponse({
      providerResponse,
      provider: "openai",
      model: "gpt-4o",
      sourceFormat: "openai",
      targetFormat: "openai",
      body: { messages: [] },
      stream: false,
      requestStartTime: Date.now() - 1000,
      trackDone: () => {},
      appendLog: () => {},
      reqLogger: { logProviderResponse: () => {}, logConvertedResponse: () => {} },
    });

    expect(result.success).toBe(true);
    expect(result.usage.completion_tokens).toBe(60);
    expect(result.usage.prompt_tokens).toBe(15);
  });
});
