import { describe, expect, it } from "vitest";
import { scoreHandoff } from "./handoff-scoring";

describe("scoreHandoff", () => {
  it("rates a close well-buffered transfer strong", () => {
    const result = scoreHandoff({
      directMiles: 42,
      directMinutes: 52,
      fromDetourMiles: 8,
      fromDetourMinutes: 18,
      toDetourMiles: 10,
      toDetourMinutes: 22,
      availableBufferMinutes: 300,
      minimumTransferMinutes: 30,
      equipmentReady: true,
    });
    expect(result.band).toBe("strong");
  });

  it("rejects equipment that is not ready", () => {
    const result = scoreHandoff({
      directMiles: 42,
      directMinutes: 52,
      fromDetourMiles: 8,
      fromDetourMinutes: 18,
      toDetourMiles: 10,
      toDetourMinutes: 22,
      availableBufferMinutes: 300,
      minimumTransferMinutes: 30,
      equipmentReady: false,
    });
    expect(result.band).toBe("infeasible");
  });

  it("rejects a transfer with too little schedule buffer", () => {
    const result = scoreHandoff({
      directMiles: 20,
      directMinutes: 25,
      fromDetourMiles: 4,
      fromDetourMinutes: 8,
      toDetourMiles: 4,
      toDetourMinutes: 8,
      availableBufferMinutes: 100,
      minimumTransferMinutes: 30,
      equipmentReady: true,
    });
    expect(result.band).toBe("infeasible");
  });
});
