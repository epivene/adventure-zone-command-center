import { describe, expect, it } from "vitest";

import { imageTokenBudget } from "./ai-client";

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
