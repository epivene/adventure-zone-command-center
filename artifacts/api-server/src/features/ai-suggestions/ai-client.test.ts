import { afterEach, describe, expect, it, vi } from "vitest";

import { imageTokenBudget, createAiClient } from "./ai-client";
afterEach(()=>vi.unstubAllEnvs());
it("constructs a disabled client without breaking the non-AI email runtime",async()=>{
 vi.stubEnv("INTERNAL_AI_ENABLED","");
 const client=await createAiClient();
 expect(client.providerName).toBe("Disabled");
 await expect(client.complete("Anything")).rejects.toMatchObject({code:"INTERNAL_AI_DISABLED"});
});

describe("imageTokenBudget", () => {
  it("keeps the existing 1200-token default", () => {
    expect(imageTokenBudget()).toBe(1200);
  });

  it("accepts an in-range paper-note budget", () => {
    expect(imageTokenBudget(2400)).toBe(2400);
    expect(imageTokenBudget(1800)).toBe(1800);
  });

  it("clamps unsafe caller values", () => {
    expect(imageTokenBudget(10)).toBe(256);
    expect(imageTokenBudget(10_000)).toBe(4096);
  });
});

