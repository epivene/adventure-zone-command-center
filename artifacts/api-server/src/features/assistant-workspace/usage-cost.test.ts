import { expect, it } from "vitest";
import {
  meterOpenAiResponse,
  summarizeCost,
  summarizeRunCost,
} from "./usage-cost";
const response = (overrides: Record<string, unknown> = {}) => ({
  id: "resp-1",
  model: "gpt-6-sol",
  service_tier: "default",
  status: "completed",
  usage: {
    input_tokens: 10000,
    output_tokens: 500,
    input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 2000 },
  },
  ...overrides,
});
it("charges ordinary input, cache reads and cache writes once at measured model rates", () => {
  const call = meterOpenAiResponse(response(), "assistant");
  // 4000*2 + 4000*.2 + 2000*2.5 + 500*10 = 18800 microdollars.
  expect(call.estimatedUsd).toBe(0.0188);
  expect(call).toMatchObject({
    model: "gpt-6-sol",
    serviceTier: "default",
    inputTokens: 10000,
    cachedInputTokens: 4000,
    cacheWriteTokens: 2000,
    outputTokens: 500,
    pricingVersion: "openai-standard-2026-09-25",
  });
  expect(summarizeCost([call])).toMatchObject({
    estimatedUsd: 0.0188,
    status: "complete",
    pricedCalls: 1,
    unpricedCalls: 0,
  });
});
it.each([
  ["gpt-6-astra", 0.094],
  ["gpt-6-luna", 0.00094],
  ["gpt-5.4-mini", 0.00705],
  ["gpt-5.4-nano-2026-03-17", 0.001905],
])("uses the published price for %s", (model, want) => {
  const raw = response({ model });
  if (model.startsWith("gpt-5.4"))
    raw.usage.input_tokens_details.cache_write_tokens = 0;
  expect(meterOpenAiResponse(raw, "document").estimatedUsd).toBe(want);
});
it.each([
  response({ model: "unknown-model" }),
  response({ model: "gpt-6-sol-2099-01-01" }),
  response({ service_tier: "priority" }),
  response({ service_tier: null }),
  response({ usage: null }),
  response({
    usage: {
      input_tokens: 10,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 11, cache_write_tokens: 0 },
    },
  }),
  response({
    usage: {
      input_tokens: 10,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
    },
  }),
  response({
    usage: {
      input_tokens: 272001,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
  }),
])(
  "does not fabricate a standard estimate from unknown or invalid metadata %#",
  (raw) => {
    expect(
      summarizeCost([meterOpenAiResponse(raw, "assistant")]),
    ).toMatchObject({
      estimatedUsd: null,
      status: "unavailable",
      pricedCalls: 0,
      unpricedCalls: 1,
    });
  },
);
it("retains known partial cost without converting unknown calls to zero", () => {
  const known = meterOpenAiResponse(response(), "assistant");
  expect(
    summarizeCost([
      known,
      meterOpenAiResponse(response({ model: "unknown" }), "assistant"),
    ]),
  ).toMatchObject({
    estimatedUsd: 0.0188,
    status: "partial",
    unpricedCalls: 1,
  });
  expect(
    summarizeCost([
      meterOpenAiResponse(response(), "research", [
        "Research tool fees excluded.",
      ]),
    ]),
  ).toMatchObject({
    estimatedUsd: 0.0188,
    status: "partial",
    excluded: ["Research tool fees excluded."],
  });
});
it("distinguishes measured zero, legacy totals and interrupted checkpoints", () => {
  const zero = meterOpenAiResponse(
    response({
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
    }),
    "assistant",
  );
  expect(summarizeCost([zero])).toMatchObject({
    estimatedUsd: 0,
    status: "complete",
  });
  expect(
    summarizeRunCost({ status: "succeeded", turn: { tokens: 12345 } }),
  ).toMatchObject({ estimatedUsd: null, status: "unavailable" });
  expect(
    summarizeRunCost({
      status: "failed",
      turn: { cost: { calls: { m: zero }, excluded: [], pendingModel: true } },
    }),
  ).toMatchObject({ estimatedUsd: 0, status: "partial" });
});
