import { describe, expect, it, vi } from "vitest";

import { persistMappedOutreachObservation } from "./google-validation-outreach-persistence";

describe("recent Gmail outreach observation replay", () => {
  it("does not mark a mapped message processed until inbound evidence persists", async () => {
    const processed = new Set<string>();
    const mappings = [{ messageId: "reply-1" }];
    const observe = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("observation unavailable"))
      .mockResolvedValueOnce(undefined);
    const markProcessed = vi.fn(async () => {
      for (const mapping of mappings) processed.add(mapping.messageId);
    });

    await expect(
      persistMappedOutreachObservation({ observe, markProcessed }),
    ).rejects.toThrow("observation unavailable");
    expect(processed).not.toContain("reply-1");

    await persistMappedOutreachObservation({ observe, markProcessed });

    expect(observe).toHaveBeenCalledTimes(2);
    expect(markProcessed).toHaveBeenCalledOnce();
    expect(processed).toContain("reply-1");
  });
});
