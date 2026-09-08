// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAll: vi.fn(),
  open: vi.fn(),
  update: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock("@/lib/business-documents-api", () => ({
  businessDocumentsApi: mocks,
}));

import BusinessDocumentsPage from "./BusinessDocumentsPage";

beforeEach(() => {
  mocks.listAll.mockReset();
  mocks.listAll.mockResolvedValue({ documents: [] });
  mocks.open.mockReset();
  mocks.update.mockReset();
  mocks.deleteDocument.mockReset();
});

function documentFixture() {
  return {
    id: "template-1", displayName: "Pirate Names", originalFilename: "Pirate Names.docx",
    category: "operational_template", lifecycle: "active", reviewState: "accepted", currentVersionId: "v1",
    effectiveDate: null, issueDate: null, expirationDate: null, notes: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    fileAvailable: true, links: [], sourceKinds: ["drive"],
  };
}

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

  it("edits a document name, type, and notes from its library card", async () => {
    mocks.listAll.mockResolvedValue({ documents: [documentFixture()] });
    mocks.update.mockResolvedValue({ document: { ...documentFixture(), displayName: "Crew Name Ideas", category: "marketing", notes: "Branding reference" } });
    render(<BusinessDocumentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Pirate Names" }));
    fireEvent.change(screen.getByLabelText("Document name"), { target: { value: "Crew Name Ideas" } });
    fireEvent.change(screen.getByLabelText("Edit document type"), { target: { value: "marketing" } });
    fireEvent.change(screen.getByLabelText("Document notes"), { target: { value: "Branding reference" } });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    expect(await screen.findByText("Crew Name Ideas")).toBeVisible();
    expect(screen.getByText("Branding reference")).toBeVisible();
  });

  it("deletes a confirmed document and removes it from the active library", async () => {
    mocks.listAll.mockResolvedValue({ documents: [documentFixture()] });
    mocks.deleteDocument.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BusinessDocumentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Pirate Names" }));

    await waitFor(() => expect(screen.queryByText("Pirate Names")).not.toBeInTheDocument());
    expect(screen.getByText("No business documents yet")).toBeVisible();
    expect(confirm).toHaveBeenCalledWith("Delete Pirate Names.docx? This removes it from the active library.");
  });
});
