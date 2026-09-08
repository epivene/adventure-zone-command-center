import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleValidationReview } from "./google-validation-review";

const { createFromReview } = vi.hoisted(() => ({
  createFromReview: vi.fn(async () => ({
    id: "profile-1",
    name: "Town of Langford",
  })),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => ({
  getGoogleWorkspaceValidationReview: vi.fn(async () => ({
    items: [{
      messageId: "m1",
      threadId: "t1",
      subject: "Quote for Summer 2027",
      from: '"Finance Office, Town of Langford" <townoflangford@venturecomm.net>',
      to: "TheAdventureZone12@gmail.com",
      internalDateMs: 1,
      evidenceCodes: [],
      candidates: [],
      hasAttachments: false,
      state: "pending",
      resolvedOrganizationId: null,
    }],
  })),
  ignoreGoogleWorkspaceValidationReview: vi.fn(async () => ({ ok: true })),
  resolveGoogleWorkspaceValidationReview: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/features/google-workspace/google-review-profile-search", () => ({
  searchGoogleReviewProfiles: vi.fn(async () => []),
}));

vi.mock("@/features/google-workspace/google-review-new-profile", () => ({
  createGoogleReviewNewProfile: createFromReview,
  suggestedGoogleReviewProfile: () => ({
    profileName: "Town of Langford",
    city: "",
    region: "",
    contactName: "Finance Office, Town of Langford",
    contactEmail: "townoflangford@venturecomm.net",
  }),
}));

describe("GoogleValidationReview create new profile", () => {
  it("creates and resolves a new profile from a business email with no existing match", async () => {
    render(<GoogleValidationReview />);

    fireEvent.click(await screen.findByRole("button", { name: /create new profile/i }));

    expect(screen.getByLabelText(/new profile name/i)).toHaveValue("Town of Langford");
    expect(screen.getByLabelText(/contact email/i)).toHaveValue("townoflangford@venturecomm.net");

    fireEvent.click(screen.getByRole("button", { name: /create profile and attach email/i }));

    await waitFor(() => {
      expect(createFromReview).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "m1", subject: "Quote for Summer 2027" }),
        expect.objectContaining({
          profileName: "Town of Langford",
          contactEmail: "townoflangford@venturecomm.net",
        }),
      );
    });
  });
});
