import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const corrections = vi.hoisted(() => ({
  changeMatchedGoogleEmailProfile: vi.fn(),
  ignoreMatchedGoogleEmail: vi.fn(),
  searchGoogleReviewProfiles: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-matched-email-corrections", () => ({
  changeMatchedGoogleEmailProfile: corrections.changeMatchedGoogleEmailProfile,
  ignoreMatchedGoogleEmail: corrections.ignoreMatchedGoogleEmail,
}));
vi.mock("@/features/google-workspace/google-review-profile-search", () => ({
  searchGoogleReviewProfiles: corrections.searchGoogleReviewProfiles,
}));

import { GoogleMatchedEmailActions } from "./google-matched-email-actions";

const row = {
  id: "m1",
  threadId: "t1",
  subject: "Paint order",
  from: "store@example.com",
  to: "theadventurezone12@gmail.com",
  date: "",
  internalDateMs: 1,
  labelIds: ["INBOX"],
  labels: [{ id: "INBOX", name: "INBOX", type: "system" as const }],
  hasAttachments: false,
  evidenceCodes: ["ai_profile_match"],
  candidates: [],
  matchedContact: null,
  resolvedOrganization: { id: "wrong", name: "Black & White Days" },
  organizationCandidates: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GoogleMatchedEmailActions", () => {
  it("lets the owner search and replace a bad matched profile", async () => {
    corrections.searchGoogleReviewProfiles.mockResolvedValue([
      { id: "right", name: "Correct Event", city: "Logan", region: "UT" },
    ]);
    corrections.changeMatchedGoogleEmailProfile.mockResolvedValue({ ok: true });
    const onAssigned = vi.fn();

    render(<GoogleMatchedEmailActions row={row} onAssigned={onAssigned} onIgnored={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change profile" }));
    fireEvent.change(screen.getByLabelText(/Search another profile/i), { target: { value: "Correct" } });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
    fireEvent.click(await screen.findByRole("button", { name: /Correct Event/i }));

    await waitFor(() => expect(corrections.changeMatchedGoogleEmailProfile).toHaveBeenCalledWith(row, "right"));
    expect(onAssigned).toHaveBeenCalledWith({ id: "right", name: "Correct Event" });
  });

  it("lets the owner ignore an incorrectly matched email", async () => {
    corrections.ignoreMatchedGoogleEmail.mockResolvedValue({ ok: true });
    const onIgnored = vi.fn();

    render(<GoogleMatchedEmailActions row={row} onAssigned={vi.fn()} onIgnored={onIgnored} />);
    fireEvent.click(screen.getByRole("button", { name: "Ignore this email" }));

    await waitFor(() => expect(corrections.ignoreMatchedGoogleEmail).toHaveBeenCalledWith(row));
    expect(onIgnored).toHaveBeenCalledTimes(1);
  });
});
