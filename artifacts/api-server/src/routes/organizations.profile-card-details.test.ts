import { describe, expect, it, vi } from "vitest";

import { loadProfileCardDetailsWith } from "./organizations";

describe("profile card detail enrichment", () => {
  it("keeps saved photo and contact details when rating lookup fails", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: "10000000-0000-4000-8000-000000000001",
        phone: "(970) 547-3100",
        email: "info@breckcreate.org",
        website: "https://gobreck.com/event/breck-pride/",
        placeType: "other",
        profileImageDataUrl: "data:image/jpeg;base64,photo",
      }] })
      .mockRejectedValueOnce(new Error("ratings unavailable"));

    const details = await loadProfileCardDetailsWith(
      ["10000000-0000-4000-8000-000000000001"],
      execute,
    );

    expect(details.get("10000000-0000-4000-8000-000000000001")).toEqual({
      id: "10000000-0000-4000-8000-000000000001",
      phone: "(970) 547-3100",
      email: "info@breckcreate.org",
      website: "https://gobreck.com/event/breck-pride/",
      placeType: "other",
      profileImageDataUrl: "data:image/jpeg;base64,photo",
      ratingAverage: null,
      ratingCount: 0,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
