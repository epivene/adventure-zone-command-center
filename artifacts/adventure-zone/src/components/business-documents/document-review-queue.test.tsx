// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reviewItems: vi.fn(), reviewAction: vi.fn() }));
vi.mock("@/lib/business-documents-api", () => ({ businessDocumentsApi: mocks }));
import { DocumentReviewQueue } from "./document-review-queue";

beforeEach(() => {
  mocks.reviewItems.mockReset().mockResolvedValue({ items: [{ id: "review-1", documentId: "doc-1", kind: "relationship", state: "pending", proposals: {}, reasonCodes: ["ambiguous_profile"], lastErrorCode: null, deferredUntil: null, displayName: "County Fair COI", originalFilename: "coi.pdf", category: "coi", createdAt: "2026-09-07T12:00:00Z" }] });
  mocks.reviewAction.mockReset().mockResolvedValue({ ok: true });
});

describe("DocumentReviewQueue", () => {
  it("requires a valid corrected target before correct-and-approve", async () => {
    render(<DocumentReviewQueue />);
    const button = await screen.findByRole("button", { name: "Correct and approve" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Correct profile ID for County Fair COI"), { target: { value: "11111111-1111-4111-8111-111111111111" } });
    expect(button).toBeEnabled();
  });

  it("removes an approved item from the unresolved queue", async () => {
    render(<DocumentReviewQueue />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.reviewAction).toHaveBeenCalledWith("review-1", { action: "approve" }));
    expect(screen.getByText("No documents need review.")).toBeVisible();
  });
});
