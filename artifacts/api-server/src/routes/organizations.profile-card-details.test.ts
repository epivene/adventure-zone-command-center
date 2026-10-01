import { describe, expect, it, vi } from "vitest";

import { loadProfileCardDetailsWith } from "../features/organizations/profile-card-details";

const profileId = "10000000-0000-4000-8000-000000000001";

describe("profile card detail enrichment", () => {
  it("keeps the saved photo even when the other card-detail queries fail", async () => {
    const reportError = vi.fn();
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: profileId,
        profileImageDataUrl: "data:image/jpeg;base64,photo",
      }] })
      .mockRejectedValueOnce(new Error("contact details unavailable"))
      .mockRejectedValueOnce(new Error("ratings unavailable"));

    const details = await loadProfileCardDetailsWith(
      [profileId],
      execute,
      reportError,
    );

    expect(details.get(profileId)).toEqual({
      id: profileId,
      phone: null,
      email: null,
      website: null,
      description: null,
      placeType: null,
      profileImageDataUrl: "data:image/jpeg;base64,photo",
      ratingAverage: null,
      ratingCount: 0,
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(reportError).toHaveBeenCalledWith("core", expect.any(Error));
    expect(reportError).toHaveBeenCalledWith("rating", expect.any(Error));
  });

  it("returns saved photo and primary-contact details together", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: profileId,
        profileImageDataUrl: "data:image/jpeg;base64,pride-photo",
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: profileId,
        phone: "(970) 547-3100",
        email: "info@breckcreate.org",
        website: "https://gobreck.com/event/breck-pride/",
        placeType: "other",
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const details = await loadProfileCardDetailsWith([profileId], execute);

    expect(details.get(profileId)).toMatchObject({
      phone: "(970) 547-3100",
      email: "info@breckcreate.org",
      website: "https://gobreck.com/event/breck-pride/",
      profileImageDataUrl: "data:image/jpeg;base64,pride-photo",
    });
  });
});
