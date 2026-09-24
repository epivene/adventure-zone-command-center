import { it, expect } from "vitest";
import { createOpenAiModel } from "./openai-model";
import { readModelConfig } from "./model-config";
import { emptySelection, type ModelInput } from "./contracts";
const config = () =>
  readModelConfig({
    ASSISTANT_WORKSPACE_ENABLED: "true",
    ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
    ASSISTANT_OPENAI_MODEL: "configured-model",
    OPENAI_API_KEY: "test",
  });
const input = (): ModelInput => ({
  instructions: "Business rules",
  turns: [
    { role: "user", text: "Review" },
    { role: "assistant", text: "Original" },
    { role: "user", text: "Make it warmer" },
  ],
  state: emptySelection(),
  evidence: [],
  providerItems: [],
  toolDefinitions: [],
  signal: new AbortController().signal,
});
const sse = (output: unknown[]) =>
  new Response(
    `data: ${JSON.stringify({ type: "response.completed", response: { id: "r1", status: "completed", output, usage: { input_tokens: 7, output_tokens: 9 } } })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
it("passes prior conversation and retains complete function calls", async () => {
  let request: any;
  const model = createOpenAiModel(config(), async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return sse([
      {
        type: "function_call",
        id: "fc1",
        call_id: "call1",
        name: "read_profile",
        arguments: '{"id":"p1"}',
      },
    ]);
  });
  const result = await model.next(input());
  expect(request.input.map((x: any) => x.content).join(" ")).toContain(
    "Make it warmer",
  );
  expect(request.input.map((x: any) => x.content).join(" ")).toContain(
    "Original",
  );
  expect(result.calls).toEqual([
    { id: "call1", name: "read_profile", arguments: '{"id":"p1"}' },
  ]);
  expect(result.inputTokens).toBe(7);
});
it("does not execute malformed function arguments", async () => {
  const model = createOpenAiModel(config(), async () =>
    sse([
      {
        type: "function_call",
        id: "fc1",
        call_id: "c1",
        name: "write",
        arguments: '{"unfinished":',
      },
    ]),
  );
  await expect(model.next(input())).rejects.toThrow(
    "ASSISTANT_MODEL_ARGUMENTS_INVALID",
  );
});
it("aborts before requesting a provider", async () => {
  let requests = 0;
  const controller = new AbortController();
  controller.abort();
  const model = createOpenAiModel(config(), async () => {
    requests++;
    return sse([]);
  });
  await expect(
    model.next({ ...input(), signal: controller.signal }),
  ).rejects.toThrow();
  expect(requests).toBe(0);
});
it("fails closed on provider rejection without a fallback provider", async () => {
  const model = createOpenAiModel(
    config(),
    async () => new Response('{"error":{"message":"denied"}}', { status: 403 }),
  );
  await expect(model.next(input())).rejects.toThrow(
    "ASSISTANT_MODEL_UNAVAILABLE",
  );
});
