// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listAll: vi.fn() }));
vi.mock("@/lib/business-documents-api", () => ({
  businessDocumentsApi: { listAll: mocks.listAll },
}));

import BusinessDocumentsPage from "./BusinessDocumentsPage";

beforeEach(() => {
  mocks.listAll.mockReset();
  mocks.listAll.mockResolvedValue({ documents: [] });
});

describe("BusinessDocumentsPage", () => {
  it("shows high-volume document categories as top-level views", async () => {
    render(<BusinessDocumentsPage />);
    expect(await screen.findByRole("tab", { name: "All Documents" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Contracts" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Vendor Applications" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Templates" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "COIs & Insurance" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Needs Review" })).toBeVisible();
  });

  it("searches filenames and combines type, status, source, link, and year filters", async () => {
    mocks.listAll.mockResolvedValue({
      documents: [
        {
          id: "contract-1", displayName: "Summer Contract", originalFilename: "summer-2026.pdf",
          category: "contract", lifecycle: "active", reviewState: "accepted", currentVersionId: "v1",
          effectiveDate: "2026-06-01", issueDate: null, expirationDate: null, notes: null,
          createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
          fileAvailable: true, links: [{ id: "l1", targetKind: "profile", targetId: "p1" }], sourceKinds: ["drive"],
        },
        {
          id: "vendor-1", displayName: "County Fair Packet", originalFilename: "vendor-application-2025.docx",
          category: "vendor_application", lifecycle: "active", reviewState: "needs_review", currentVersionId: "v2",
          effectiveDate: null, issueDate: null, expirationDate: null, notes: "September fair",
          createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
          fileAvailable: true, links: [], sourceKinds: ["gmail"],
        },
      ],
    });
    render(<BusinessDocumentsPage />);
    expect(await screen.findByText("Summer Contract")).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), { target: { value: "vendor-application" } });
    expect(screen.getByText("County Fair Packet")).toBeVisible();
    expect(screen.queryByText("Summer Contract")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "vendor_application" } });
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "needs_review" } });
    fireEvent.change(screen.getByLabelText("Document source"), { target: { value: "gmail" } });
    fireEvent.change(screen.getByLabelText("Link status"), { target: { value: "unlinked" } });
    fireEvent.change(screen.getByLabelText("Document year"), { target: { value: "2025" } });

    expect(screen.getByText("County Fair Packet")).toBeVisible();
    expect(screen.queryByText("Summer Contract")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("Summer Contract")).toBeVisible();
  });

  it("explains that an empty library can import or upload files", async () => {
    render(<BusinessDocumentsPage />);
    expect(await screen.findByText("No business documents yet")).toBeVisible();
    expect(screen.getByRole("link", { name: "Import business documents" })).toHaveAttribute("href", "/business-documents/import");
  });
});
