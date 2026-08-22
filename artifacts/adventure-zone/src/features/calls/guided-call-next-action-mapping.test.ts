import { describe, expect, it } from "vitest";
import { normalizeSuggestedAction } from "@/components/calls/call-workspace";

describe("guided call next-action mapping", () => {
  it("maps descriptive objection follow-ups to supported saved action kinds", () => {
    expect(normalizeSuggestedAction("send_mini_zone_info")).toBe("send_information");
    expect(normalizeSuggestedAction("send_insurance_safety_info")).toBe("send_information");
    expect(normalizeSuggestedAction("owner_follow_up")).toBe("call");
  });

  it("preserves the existing mappings", () => {
    expect(normalizeSuggestedAction("send_info")).toBe("send_information");
    expect(normalizeSuggestedAction("send_proposal")).toBe("prepare_quote");
    expect(normalizeSuggestedAction("future_season")).toBe("call");
  });
});
