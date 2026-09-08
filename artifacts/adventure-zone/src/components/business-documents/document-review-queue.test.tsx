// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ open: vi.fn(), reviewItems: vi.fn(), reviewAction: vi.fn(), searchProfiles: vi.fn() }));
vi.mock("@/lib/business-documents-api", () => ({ businessDocumentsApi: mocks }));
import { DocumentReviewQueue } from "./document-review-queue";

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.open.mockReset().mockResolvedValue("https://files.example.test/doc-1");
  mocks.reviewItems.mockReset().mockResolvedValue({ items: [{ id: "review-1", documentId: "doc-1", kind: "relationship", state: "pending", proposals: {}, reasonCodes: ["ambiguous_profile"], lastErrorCode: null, deferredUntil: null, displayName: "County Fair COI", originalFilename: "coi.pdf", category: "coi", createdAt: "2026-09-07T12:00:00Z" }] });
  mocks.reviewAction.mockReset().mockResolvedValue({ ok: true });
  mocks.searchProfiles.mockReset().mockResolvedValue([]);
});

describe("DocumentReviewQueue", () => {
  it("opens the protected document without removing its review", async () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<DocumentReviewQueue />);

    fireEvent.click(await screen.findByRole("button", { name: "Open protected file for County Fair COI" }));

    await waitFor(() => expect(openWindow).toHaveBeenCalledWith(
      "https://files.example.test/doc-1",
      "_blank",
      "noopener,noreferrer",
    ));
    expect(screen.getByText("County Fair COI")).toBeVisible();
  });

  it("keeps the review visible and explains when its protected file cannot open", async () => {
    mocks.open.mockRejectedValueOnce(new Error("file unavailable"));
    vi.spyOn(window, "open").mockImplementation(() => null);
    render(<DocumentReviewQueue />);

    fireEvent.click(await screen.findByRole("button", { name: "Open protected file for County Fair COI" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That protected file is not available right now.");
    expect(screen.getByText("County Fair COI")).toBeVisible();
  });

  it("lets the reviewer correct the document type without a profile ID", async () => {
    render(<DocumentReviewQueue />);
    fireEvent.change(await screen.findByLabelText("Document type for County Fair COI"), { target: { value: "proposal" } });
    expect(screen.getByRole("button", { name: "Approve as shown" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save corrections and approve" }));
    await waitFor(() => expect(mocks.reviewAction).toHaveBeenCalledWith("review-1", {
      action: "correct_and_approve",
      corrections: { category: "proposal" },
    }));
  });

  it("searches for a profile by name and saves the selected match", async () => {
    mocks.searchProfiles.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", name: "North Ogden Cherry Days", city: "North Ogden", region: "UT" }]);
    render(<DocumentReviewQueue />);
    fireEvent.change(await screen.findByLabelText("Profile search for County Fair COI"), { target: { value: "North Ogden" } });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
    fireEvent.click(await screen.findByRole("button", { name: /North Ogden Cherry Days/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save corrections and approve" }));
    await waitFor(() => expect(mocks.reviewAction).toHaveBeenCalledWith("review-1", {
      action: "correct_and_approve",
      corrections: {
        category: "coi",
        targets: [{ targetKind: "profile", targetId: "11111111-1111-4111-8111-111111111111" }],
      },
    }));
  });

  it("removes an approved item from the unresolved queue", async () => {
    render(<DocumentReviewQueue />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve as shown" }));
    await waitFor(() => expect(mocks.reviewAction).toHaveBeenCalledWith("review-1", { action: "approve" }));
    expect(screen.getByText("No documents need review.")).toBeVisible();
  });
});
