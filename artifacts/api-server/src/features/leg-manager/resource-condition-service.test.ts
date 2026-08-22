import { describe, expect, it } from "vitest";
import { resourceStatusEffectForChecklistResult } from "./resource-condition-service";

describe("resource condition effects", () => {
  it("leaves a resource available for needs-work-but-safe", () => {
    expect(resourceStatusEffectForChecklistResult("needs_work_safe", "available")).toBe("available");
  });

  it("takes an unsafe resource out of service", () => {
    expect(resourceStatusEffectForChecklistResult("unsafe", "available")).toBe("unavailable");
    expect(resourceStatusEffectForChecklistResult("unsafe", "maintenance")).toBe("unavailable");
  });

  it("does not change resource status for site-wide results with no resource", () => {
    expect(resourceStatusEffectForChecklistResult("unsafe", null)).toBeNull();
  });
});
