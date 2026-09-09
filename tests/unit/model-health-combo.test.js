import { describe, it, expect } from "vitest";
import { handleComboChat } from "open-sse/services/combo.js";

function okResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 });
}

describe("handleComboChat healthSorter", () => {
  it("tries models in healthSorter order", async () => {
    const tried = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "x" }] },
      models: ["openai/a", "openai/b"],
      healthSorter: (models) => [models[1], models[0]],
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        if (model === "openai/b") return okResponse();
        return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 503 });
      },
      log: { info() {}, warn() {}, error() {} },
      comboName: "test",
    });
    expect(tried).toEqual(["openai/b"]);
    expect(result.ok).toBe(true);
  });

  it("still falls through to the tail model when all healthy ones fail", async () => {
    const tried = [];
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["openai/a", "openai/b"],
      healthSorter: (models) => [models[1], models[0]],
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 503 });
      },
      log: { info() {}, warn() {}, error() {} },
      comboName: "test",
    });
    expect(tried).toEqual(["openai/b", "openai/a"]);
    expect(result.ok).toBe(false);
  });
});
