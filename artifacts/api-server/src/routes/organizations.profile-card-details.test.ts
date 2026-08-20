import { describe, expect, it, vi } from "vitest";

import { loadProfileCardDetailsWith } from "./organizations";

describe("profile card detail enrichment", () => {
  it("keeps the saved photo even when the other card-detail queries fail", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: "10000000-0000-4000-8000-000000000001",
        profileImageDataUrl: "data:image/jpeg;base64,photo",
      }] })
      .mockRejectedValueOnce(new Error("contact details unavailable"))
      .mockRejectedValueOnce(new Error("ratings unavailable"));

    const details = await loadProfileCardDetailsWith(
      ["10000000-0000-4000-8000-000000000001"],
      execute,
    );

    expect(details.get("10000000-0000-4000-8000-000000000001")).toEqual({
      id: "10000000-0000-4000-8000-000000000001",
      phone: null,
      email: null,
      website: null,
      placeType: null,
      profileImageDataUrl: "data:image/jpeg;base64,photo",
      ratingAverage: null,
      ratingCount: 0,
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
