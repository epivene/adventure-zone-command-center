import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleWorkspaceValidationReview: vi.fn(),
  resolveGoogleWorkspaceValidationReview: vi.fn(),
  ignoreGoogleWorkspaceValidationReview: vi.fn(),
  searchGoogleWorkspaceReviewProfiles: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);

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
};

beforeEach(() => {
  client.getGoogleWorkspaceValidationReview.mockResolvedValue({ items: [item] });
  client.resolveGoogleWorkspaceValidationReview.mockResolvedValue({ ok: true });
  client.ignoreGoogleWorkspaceValidationReview.mockResolvedValue({ ok: true });
  client.searchGoogleWorkspaceReviewProfiles.mockResolvedValue([
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
  });
});
