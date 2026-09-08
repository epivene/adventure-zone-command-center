import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleWorkspaceValidationReview: vi.fn(),
  resolveGoogleWorkspaceValidationReview: vi.fn(),
  ignoreGoogleWorkspaceValidationReview: vi.fn(),
  retryGoogleWorkspaceGmailMutation: vi.fn(),
}));
const search = vi.hoisted(() => ({
  searchGoogleReviewProfiles: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);
vi.mock("@/features/google-workspace/google-review-profile-search", () => search);

import { GoogleValidationReview } from "./google-validation-review";

const item = {
  messageId: "m1",
  threadId: "t1",
  subject: "County Fair application",
  from: "events@example.org",
  to: "zone@example.com",
  internalDateMs: 1,
  evidenceCodes: ["exact_profile_name_text"],
  candidates: [{ id: "11111111-1111-4111-8111-111111111111", name: "County Fair" }],
  hasAttachments: true,
  state: "pending" as const,
  resolvedOrganizationId: null,
  gmailSyncState: "not_requested" as const,
  gmailSyncErrorCode: null,
  gmailSyncMutationId: null,
};

beforeEach(() => {
  client.getGoogleWorkspaceValidationReview.mockResolvedValue({ items: [item] });
  client.resolveGoogleWorkspaceValidationReview.mockResolvedValue({
    ok: true,
    gmailSync: {
      mutationId: "33333333-3333-4333-8333-333333333333",
      state: "completed",
      gmailLabelId: "Label_1",
      gmailLabelName: "Z - AdventureZone/Profiles/County Fair",
      errorCode: null,
    },
  });
  client.ignoreGoogleWorkspaceValidationReview.mockResolvedValue({ ok: true });
  search.searchGoogleReviewProfiles.mockResolvedValue([
    { id: "22222222-2222-4222-8222-222222222222", name: "Another Fair" },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GoogleValidationReview", () => {
  it("shows pending items and lets the owner use a suggested profile", async () => {
    render(<GoogleValidationReview />);

    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assign to County Fair" }));

    await waitFor(() =>
      expect(client.resolveGoogleWorkspaceValidationReview).toHaveBeenCalledWith(
        "m1",
        "11111111-1111-4111-8111-111111111111",
      ),
    );
    expect(await screen.findByText("Assigned to the profile and archived in Gmail."))
      .toBeInTheDocument();
  });

  it("can search for a different profile and assign it", async () => {
    render(<GoogleValidationReview />);
    await screen.findByText("County Fair application");

    fireEvent.change(screen.getByLabelText("Search profiles for County Fair application"), {
      target: { value: "another" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));

    expect(await screen.findByText("Another Fair")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assign to Another Fair" }));
    await waitFor(() =>
      expect(client.resolveGoogleWorkspaceValidationReview).toHaveBeenCalledWith(
        "m1",
        "22222222-2222-4222-8222-222222222222",
      ),
    );
  });

  it("can explicitly ignore an irrelevant review item", async () => {
    render(<GoogleValidationReview />);
    await screen.findByText("County Fair application");
    fireEvent.click(screen.getByRole("button", { name: "Ignore this email" }));
    await waitFor(() =>
      expect(client.ignoreGoogleWorkspaceValidationReview).toHaveBeenCalledWith("m1"),
    );
    expect(await screen.findByText(
      "Ignored in Email Review. Gmail was left unchanged and the thread stays in Inbox.",
    )).toBeInTheDocument();
  });

  it("offers an immediate retry when Gmail synchronization is retryable", async () => {
    client.resolveGoogleWorkspaceValidationReview.mockResolvedValueOnce({
      ok: true,
      gmailSync: {
        mutationId: "33333333-3333-4333-8333-333333333333",
        state: "retryable_error",
        gmailLabelId: null,
        gmailLabelName: null,
        errorCode: "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED",
      },
    });
    client.retryGoogleWorkspaceGmailMutation.mockResolvedValueOnce({
      ok: true,
      gmailSync: {
        mutationId: "33333333-3333-4333-8333-333333333333",
        state: "completed",
        gmailLabelId: "Label_1",
        gmailLabelName: "Z - AdventureZone/Profiles/County Fair",
        errorCode: null,
      },
    });
    render(<GoogleValidationReview />);
    await screen.findByText("County Fair application");

    fireEvent.click(screen.getByRole("button", { name: "Assign to County Fair" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry Gmail" }));

    await waitFor(() => expect(client.retryGoogleWorkspaceGmailMutation)
      .toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333"));
    expect(await screen.findByText("Assigned to the profile and archived in Gmail."))
      .toBeInTheDocument();
  });
});
