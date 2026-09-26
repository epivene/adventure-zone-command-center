import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVisualReader, createOwnedVisualReader } from "./visual-reader";
import { readModelConfig } from "./model-config";
const config = () =>
  readModelConfig({
    ASSISTANT_WORKSPACE_ENABLED: "true",
    ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
    ASSISTANT_OPENAI_MODEL: "chosen-model",
    OPENAI_API_KEY: "test",
  });
const input = () => ({
  bytes: new Uint8Array([1, 2]),
  mimeType: "image/png",
  missingPages: [1],
  signal: new AbortController().signal,
});
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("No unstubbed provider requests in tests");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it("keeps known usage and partial text on incomplete visual responses", async () => {
  let request: any;
  const read = createVisualReader(config(), async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: "r",
        status: "incomplete",
        model: "gpt-6-sol",
        service_tier: "default",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Visible date: 2027" }],
          },
        ],
        usage: {
          input_tokens: 31,
          output_tokens: 12,
          input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 },
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const result = await read(input());
  expect(request.model).toBe("chosen-model");
  expect(result.usage).toEqual({ inputTokens: 31, outputTokens: 12 });
  expect(result.usageUnknown).toBe(false);
  expect(result.model).toBe("gpt-6-sol");
  expect(result.costCalls).toHaveLength(1);
  expect(result.costCalls?.[0]).toMatchObject({
    responseId: "r",
    source: "document",
    model: "gpt-6-sol",
    serviceTier: "default",
    inputTokens: 31,
    cachedInputTokens: 2,
    cacheWriteTokens: 0,
    outputTokens: 12,
    observedAt: expect.any(String),
    pricingVersion: expect.any(String),
    estimatedUsd: expect.any(Number),
    excluded: expect.arrayContaining([
      expect.stringContaining("did not complete"),
    ]),
  });
  expect(result.text).toContain("Visible date: 2027");
  expect(result.text).toContain("incomplete");
});
it("bounds the full response body and reports transport usage uncertainty without retry", async () => {
  const fetcher = vi.fn(
    async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(new Error("aborted response body")),
              { once: true },
            );
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const read = createVisualReader({ ...config(), timeoutMs: 30 }, fetcher);
  const result = await read(input());
  expect(result.usageUnknown).toBe(true);
  expect(result.usage).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not label missing usage as zero", async () => {
  const read = createVisualReader(
    config(),
    async () =>
      new Response(
        JSON.stringify({ id: "r", status: "completed", output: [] }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  expect((await read(input())).usageUnknown).toBe(true);
});
it("selects the saved owned run's model and rejects a mismatched conversation before requesting", async () => {
  const fetcher = vi.fn(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).model).toBe("run-model");
    return new Response(
      JSON.stringify({
        id: "r",
        status: "completed",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const runs: any = {
    get: vi.fn(async () => ({
      conversationId: "c",
      input: { model: "run-model" },
    })),
  };
  const read = createOwnedVisualReader(
    { ...config(), models: ["chosen-model", "run-model"] },
    runs,
    fetcher,
  );
  const context: any = {
    actor: { id: "owner", role: "owner" },
    runId: "r",
    conversationId: "c",
  };
  await read({ ...input(), context });
  await read({ ...input(), context: { ...context, conversationId: "other" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(runs.get).toHaveBeenCalledWith("owner", "r");
});

it("retains billed provider metadata when visual output cannot be parsed", async () => {
  const read = createVisualReader(
    config(),
    async () =>
      new Response(
        JSON.stringify({
          id: "visual-malformed",
          status: "completed",
          model: "gpt-6-sol",
          service_tier: "default",
          output: [{ type: "message", content: null }],
          usage: {
            input_tokens: 41,
            output_tokens: 9,
            input_tokens_details: { cached_tokens: 3, cache_write_tokens: 0 },
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const result = await read(input());
  expect(result.text).toContain("review the original");
  expect(result.usage).toEqual({ inputTokens: 41, outputTokens: 9 });
  expect(result.usageUnknown).toBe(false);
  expect(result.model).toBe("gpt-6-sol");
  expect(result.costCalls).toHaveLength(1);
  expect(result.costCalls?.[0]).toMatchObject({
    responseId: "visual-malformed",
    source: "document",
    model: "gpt-6-sol",
    inputTokens: 41,
    cachedInputTokens: 3,
    outputTokens: 9,
  });
});
