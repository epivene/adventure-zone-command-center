import { describe, expect, it } from "vitest";

import { normalizeProposalBatchIds } from "./assistant-change-approval-service";

describe("assistant website fix approval", () => {
  it("requires an explicit non-empty immutable proposal ID batch", () => {
    expect(() => normalizeProposalBatchIds([])).toThrow(/proposal/i);
    expect(() => normalizeProposalBatchIds(["a", "a"])).toThrow(/duplicate/i);
    expect(normalizeProposalBatchIds(["b", "a"])).toEqual(["a", "b"]);
  });

  it("limits the approval batch so the client cannot submit an unbounded mutation", () => {
    expect(() => normalizeProposalBatchIds(Array.from({ length: 251 }, (_, index) => String(index))))
      .toThrow(/250/);
  });
});
