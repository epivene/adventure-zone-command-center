// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ forProfile: vi.fn(), open: vi.fn(), unlink: vi.fn() }));
vi.mock("@/lib/business-documents-api", () => ({
  businessDocumentsApi: mocks,
}));

import { ProfileDocuments } from "./profile-documents";

const document = {
  id: "doc-1",
  displayName: "City COI",
  originalFilename: "city-coi.pdf",
  category: "coi",
  lifecycle: "active",
  reviewState: "accepted",
  currentVersionId: "version-1",
  effectiveDate: null,
  issueDate: null,
  expirationDate: "2027-01-01",
  notes: null,
  createdAt: "2026-09-07T12:00:00.000Z",
  updatedAt: "2026-09-07T12:00:00.000Z",
  fileAvailable: true,
  links: [{ id: "link-1", targetKind: "profile", targetId: "profile-1" }],
};

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.forProfile.mockResolvedValue({ documents: [document] });
  mocks.unlink.mockResolvedValue({ ok: true });
});

describe("ProfileDocuments", () => {
  it("shows profile-linked documents and central-library navigation", async () => {
    render(<ProfileDocuments profileId="profile-1" />);
    expect(await screen.findByText("City COI")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open document library" })).toHaveAttribute("href", "/business-documents?profileId=profile-1");
  });

  it("removes a profile link without offering to delete the file", async () => {
    render(<ProfileDocuments profileId="profile-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove from this profile" }));
    await waitFor(() => expect(mocks.unlink).toHaveBeenCalledWith("doc-1", "link-1"));
    expect(screen.queryByText(/delete document/i)).not.toBeInTheDocument();
  });
});
