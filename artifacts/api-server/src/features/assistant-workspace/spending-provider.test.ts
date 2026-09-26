import OpenAI from "openai";
import { expect, it, vi } from "vitest";
import {
  preparePaidResponse,
  SpendingPreflightError,
  type SpendingPort,
} from "./spending-provider";
import { chooseEconomyModel, modelForEconomy } from "./spending-policy";

const scope = {
  actorId: "owner",
  conversationId: "conversation",
  runId: "run",
  callId: "run:assistant:0",
  source: "assistant" as const,
  model: "gpt-6-luna",
};
const request = () => ({
  model: scope.model,
  service_tier: "default" as const,
  max_output_tokens: 2048,
  input: "Hello",
  store: false,
});
const spending = (): SpendingPort => ({
  summary: vi.fn(async () => ({ economyMode: true })),
  reserve: vi.fn(async () => {}),
  settle: vi.fn(async () => {}),
});
const provider = (tokens = 100) =>
  new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: vi.fn(async () =>
      Response.json({ object: "response.input_tokens", input_tokens: tokens }),
    ),
  });
const signal = () => new AbortController().signal;
const response = () => ({
  id: "response",
  model: scope.model,
  service_tier: "default",
  status: "completed",
  usage: { input_tokens: 100, output_tokens: 20 },
  output: [],
});

it("counts actual multimodal input, instructions and tools before reserving the maximum generation", async () => {
  const budget = spending();
  let counted: any;
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (url, init) => {
      expect(String(url)).toContain("/responses/input_tokens");
      expect(budget.reserve).not.toHaveBeenCalled();
      counted = JSON.parse(String(init?.body));
      return Response.json({
        object: "response.input_tokens",
        input_tokens: 3200,
      });
    },
  });
  const payload: any = {
    ...request(),
    instructions: "Business context",
    tools: [
      {
        type: "function",
        name: "read_profile",
        parameters: { type: "object" },
        strict: false,
      },
    ],
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: "data:image/png;base64,AQ==",
            detail: "high",
          },
          {
            type: "input_file",
            filename: "doc.pdf",
            file_data: "data:application/pdf;base64,AQ==",
          },
        ],
      },
    ],
  };
  const reservation = await preparePaidResponse(
    client,
    budget,
    scope,
    payload,
    signal(),
  );
  expect(counted.input).toEqual(payload.input);
  expect(counted.instructions).toBe(payload.instructions);
  expect(counted.tools).toEqual(payload.tools);
  expect(counted).not.toHaveProperty("max_output_tokens");
  expect(budget.reserve).toHaveBeenCalledWith(scope, 3200 * 125 + 2048 * 500);
  await reservation.finish(response());
  // Conservatively charge every input token at the write/input maximum.
  expect(budget.settle).toHaveBeenCalledWith(
    "owner",
    scope.callId,
    100 * 125 + 20 * 500,
  );
});

it("uses the long-context tier when counting exceeds the short-context boundary", async () => {
  const budget = spending();
  await preparePaidResponse(
    provider(272001),
    budget,
    scope,
    request(),
    signal(),
  );
  expect(budget.reserve).toHaveBeenCalledWith(scope, 272001 * 250 + 2048 * 750);
});

it("counts initial search input and reserves unknown future search content and tool fees", async () => {
  const budget = spending();
  const fetcher = vi.fn(async () =>
    Response.json({ object: "response.input_tokens", input_tokens: 100 }),
  );
  const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: fetcher });
  const reservation = await preparePaidResponse(
    client,
    budget,
    { ...scope, source: "research" },
    { ...request(), tools: [{ type: "web_search" }], max_tool_calls: 1 },
    signal(),
  );
  expect(fetcher).toHaveBeenCalledOnce();
  expect(budget.reserve).toHaveBeenCalledWith(
    expect.anything(),
    ((100 + 2048 + 128_000) * 2 + 128_000) * 125 + 2048 * 500 + 10_000_000,
  );
  await reservation.finish({
    ...response(),
    output: [{ type: "web_search_call", status: "completed" }],
  });
  expect(budget.settle).toHaveBeenCalledWith(
    "owner",
    scope.callId,
    (100 + 128_000) * 125 + 20 * 500 + 10_000_000,
  );
});

it.each([
  undefined,
  { ...response(), status: "incomplete" },
  { ...response(), usage: undefined },
  { ...response(), usage: { input_tokens: -1, output_tokens: 1 } },
  { ...response(), model: "gpt-6-sol" },
  { ...response(), service_tier: "priority" },
  { ...response(), output: [{ type: "web_search_call", status: "completed" }] },
])(
  "retains the reservation for unknown, incomplete or unexpected provider metadata: %j",
  async (raw) => {
    const budget = spending();
    const reservation = await preparePaidResponse(
      provider(),
      budget,
      scope,
      request(),
      signal(),
    );
    await reservation.finish(raw);
    await reservation.finish(response());
    expect(budget.settle).toHaveBeenCalledExactlyOnceWith(
      "owner",
      scope.callId,
      null,
    );
  },
);

it("records an observed overrun rather than clipping it to the reservation", async () => {
  const budget = spending();
  const reservation = await preparePaidResponse(
    provider(),
    budget,
    scope,
    request(),
    signal(),
  );
  await reservation.finish({
    ...response(),
    usage: { input_tokens: 300000, output_tokens: 3000 },
  });
  expect(budget.settle).toHaveBeenCalledWith(
    "owner",
    scope.callId,
    300000 * 250 + 3000 * 750,
  );
});

it("fails closed without reserving when counting fails, returns invalid usage or lacks a verified model price", async () => {
  const budget = spending();
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async () => new Response("denied", { status: 403 }),
  });
  await expect(
    preparePaidResponse(client, budget, scope, request(), signal()),
  ).rejects.toMatchObject({
    message: "ASSISTANT_SPENDING_INPUT_COUNT_UNAVAILABLE",
    safeToRetry: true,
  });
  await expect(
    preparePaidResponse(provider(-1), budget, scope, request(), signal()),
  ).rejects.toThrow("ASSISTANT_SPENDING_INPUT_COUNT_INVALID");
  await expect(
    preparePaidResponse(
      provider(),
      budget,
      { ...scope, model: "unpriced" },
      { ...request(), model: "unpriced" },
      signal(),
    ),
  ).rejects.toThrow("ASSISTANT_SPENDING_MODEL_UNPRICED");
  const nano = "gpt-5.4-nano";
  await expect(
    preparePaidResponse(
      provider(400001),
      budget,
      { ...scope, model: nano },
      { ...request(), model: nano },
      signal(),
    ),
  ).rejects.toThrow("ASSISTANT_SPENDING_INPUT_COUNT_INVALID");
  expect(budget.reserve).not.toHaveBeenCalled();
});

it("distinguishes a denied new call from an already claimed call", async () => {
  for (const [code, safeToRetry] of [
    ["ASSISTANT_BUDGET_LIMIT", true],
    ["ASSISTANT_BUDGET_CALL_EXISTS", false],
  ] as const) {
    const budget = spending();
    vi.mocked(budget.reserve).mockRejectedValue(new Error(code));
    await expect(
      preparePaidResponse(provider(), budget, scope, request(), signal()),
    ).rejects.toMatchObject({ message: code, safeToRetry });
    expect(budget.settle).not.toHaveBeenCalled();
  }
});

it("never classifies a settlement failure as a safe preflight retry", async () => {
  const budget = spending();
  vi.mocked(budget.settle).mockRejectedValue(new Error("Database unavailable"));
  const reservation = await preparePaidResponse(
    provider(),
    budget,
    scope,
    request(),
    signal(),
  );
  const error = await reservation.finish(response()).catch((error) => error);
  expect(error).not.toBeInstanceOf(SpendingPreflightError);
  expect(error.message).toBe("ASSISTANT_PROVIDER_SETTLEMENT_UNAVAILABLE");
});

it("requires stable scope, explicit standard tier and bounded priced tools", async () => {
  const budget = spending();
  await expect(
    preparePaidResponse(provider(), budget, undefined, request(), signal()),
  ).rejects.toThrow("ASSISTANT_SPENDING_SCOPE_REQUIRED");
  await expect(
    preparePaidResponse(
      provider(),
      budget,
      scope,
      { ...request(), service_tier: "auto" },
      signal(),
    ),
  ).rejects.toThrow("ASSISTANT_SPENDING_REQUEST_INVALID");
  await expect(
    preparePaidResponse(
      provider(),
      budget,
      scope,
      { ...request(), max_output_tokens: undefined },
      signal(),
    ),
  ).rejects.toThrow("ASSISTANT_SPENDING_OUTPUT_LIMIT_REQUIRED");
  await expect(
    preparePaidResponse(
      provider(),
      budget,
      scope,
      { ...request(), tools: [{ type: "web_search" }] },
      signal(),
    ),
  ).rejects.toThrow("ASSISTANT_SPENDING_SEARCH_LIMIT_REQUIRED");
  expect(budget.reserve).not.toHaveBeenCalled();
});

it("selects the cheapest configured verified model while respecting an explicit non-economy choice", () => {
  expect(
    chooseEconomyModel(["unpriced", "gpt-6-sol", "gpt-5.4-nano", "gpt-6-luna"]),
  ).toBe("gpt-6-luna");
  expect(chooseEconomyModel(["gpt-6-astra", "gpt-5.4-nano-2026-03-17"])).toBe(
    "gpt-5.4-nano-2026-03-17",
  );
  expect(chooseEconomyModel(["unpriced"])).toBeUndefined();
  expect(
    modelForEconomy(
      { model: "gpt-6-sol", models: ["gpt-6-luna", "gpt-6-sol"] },
      "gpt-6-sol",
      false,
    ),
  ).toBe("gpt-6-sol");
});

it("supports the verified flat mini/nano full-context rates and blocks unpriced regional endpoints", async () => {
  const budget = spending();
  const nano = "gpt-5.4-nano";
  await preparePaidResponse(
    provider(400000),
    budget,
    { ...scope, model: nano },
    { ...request(), model: nano },
    signal(),
  );
  expect(budget.reserve).toHaveBeenCalledWith(
    { ...scope, model: nano },
    400000 * 200 + 2048 * 1250,
  );
  const fetcher = vi.fn(async () => Response.json({ input_tokens: 100 }));
  const regional = new OpenAI({
    apiKey: "test",
    baseURL: "https://us.api.openai.com/v1",
    fetch: fetcher,
  });
  await expect(
    preparePaidResponse(regional, budget, scope, request(), signal()),
  ).rejects.toThrow("ASSISTANT_SPENDING_ENDPOINT_UNPRICED");
  expect(fetcher).not.toHaveBeenCalled();
});

it("labels cancellation before a reservation as safely retryable with no uncertain charge", async () => {
  const budget = spending();
  const controller = new AbortController();
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async () => {
      controller.abort();
      throw new Error("Counting cancelled");
    },
  });
  await expect(
    preparePaidResponse(client, budget, scope, request(), controller.signal),
  ).rejects.toMatchObject({
    message: "ASSISTANT_CANCELLED",
    safeToRetry: true,
  });
  expect(budget.reserve).not.toHaveBeenCalled();
  expect(budget.settle).not.toHaveBeenCalled();
});

it("keeps a search hold when a required search has no verifiable completed tool result", async () => {
  const budget = spending();
  const reservation = await preparePaidResponse(
    provider(),
    budget,
    { ...scope, source: "research" },
    { ...request(), tools: [{ type: "web_search" }], max_tool_calls: 1 },
    signal(),
  );
  await reservation.finish(response());
  expect(budget.settle).toHaveBeenCalledWith("owner", scope.callId, null);
});
