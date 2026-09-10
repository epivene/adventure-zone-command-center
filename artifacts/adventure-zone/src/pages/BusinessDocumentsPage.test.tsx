// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAll: vi.fn(),
  open: vi.fn(),
  update: vi.fn(),
  deleteDocument: vi.fn(),
  searchProfiles: vi.fn(),
  linkProfile: vi.fn(),
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
  mocks.searchProfiles.mockReset();
  mocks.searchProfiles.mockResolvedValue([]);
  mocks.linkProfile.mockReset();
  mocks.linkProfile.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

function documentFixture() {
  return {
    id: "template-1", displayName: "Pirate Names", originalFilename: "Pirate Names.docx",
    category: "operational_template", lifecycle: "active", reviewState: "accepted", currentVersionId: "v1",
    effectiveDate: null, issueDate: null, expirationDate: null, notes: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    fileAvailable: true, links: [], sourceKinds: ["drive"],
  };
}

function openFolder(label: string) {
  const folder = screen.getByLabelText(`${label} folder`);
  fireEvent.click(folder.querySelector("summary")!);
  return folder;
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
    expect(screen.getByRole("tab", { name: "Media" })).toBeVisible();
  });

  it("keeps media out of the document library and gives it a dedicated view", async () => {
    mocks.listAll.mockResolvedValue({
      documents: [
        { ...documentFixture(), id: "contract", displayName: "Big E Contract", originalFilename: "Big E Contract 2026.pdf", category: "contract" },
        { ...documentFixture(), id: "photo", displayName: "Big E Booth", originalFilename: "Big E Booth 2026.jpg", category: "marketing" },
      ],
    });
    render(<BusinessDocumentsPage />);

    expect(await screen.findByText("Big E Contract")).toBeInTheDocument();
    expect(screen.queryByText("Big E Booth")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getByText("Big E Booth")).toBeInTheDocument();
    expect(screen.queryByText("Big E Contract")).not.toBeInTheDocument();
  });

  it("groups regular documents into collapsible type, year, and confirmed-event folders", async () => {
    mocks.listAll.mockResolvedValue({
      documents: [
        { ...documentFixture(), id: "signed", displayName: "Big E Contract 2026 Signed", originalFilename: "Big E Contract 2026 Signed.pdf", category: "contract", effectiveDate: "2026-09-01", links: [{ id: "l1", targetKind: "profile", targetId: "p1", targetLabel: "Big E" }] },
        { ...documentFixture(), id: "draft", displayName: "Big E Contract 2026 Draft", originalFilename: "Big E Contract 2026 Draft.docx", category: "contract", effectiveDate: "2026-09-01", links: [{ id: "l2", targetKind: "profile", targetId: "p1", targetLabel: "Big E" }] },
      ],
    });
    render(<BusinessDocumentsPage />);

    const contracts = await screen.findByLabelText("Contracts folder");
    expect(contracts).not.toHaveAttribute("open");
    openFolder("Contracts");
    const year = screen.getByLabelText("2026 folder");
    expect(year).not.toHaveAttribute("open");
    openFolder("2026");
    const event = screen.getByLabelText("Big E folder");
    expect(event).not.toHaveAttribute("open");
    openFolder("Big E");
    expect(screen.getByText("Big E Contract 2026 Signed")).toBeVisible();
    expect(screen.getByText("Big E Contract 2026 Draft")).toBeVisible();
  });

  it("surfaces pending reviews as the primary sorting inbox", async () => {
    mocks.listAll.mockResolvedValue({
      documents: [
        { ...documentFixture(), id: "review-1", displayName: "Unknown Fair File", reviewState: "needs_review" },
        { ...documentFixture(), id: "review-2", displayName: "Unlinked Contract", reviewState: "needs_review" },
      ],
    });
    render(<BusinessDocumentsPage />);

    expect(await screen.findByRole("heading", { name: "2 documents need sorting" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Needs Review" })).toBeVisible();
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
    expect(await screen.findByText("Summer Contract")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), { target: { value: "vendor-application" } });
    expect(screen.getByText("County Fair Packet")).toBeInTheDocument();
    expect(screen.queryByText("Summer Contract")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "vendor_application" } });
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "needs_review" } });
    fireEvent.change(screen.getByLabelText("Document source"), { target: { value: "gmail" } });
    fireEvent.change(screen.getByLabelText("Link status"), { target: { value: "unlinked" } });
    fireEvent.change(screen.getByLabelText("Document year"), { target: { value: "2025" } });

    expect(screen.getByText("County Fair Packet")).toBeInTheDocument();
    expect(screen.queryByText("Summer Contract")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("Summer Contract")).toBeInTheDocument();
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

    await screen.findByLabelText("Operational Templates folder");
    openFolder("Operational Templates");
    openFolder("2026");
    openFolder("Needs Sorting");
    fireEvent.click(await screen.findByRole("button", { name: "Edit Pirate Names" }));
    fireEvent.change(screen.getByLabelText("Document name"), { target: { value: "Crew Name Ideas" } });
    fireEvent.change(screen.getByLabelText("Edit document type"), { target: { value: "marketing" } });
    fireEvent.change(screen.getByLabelText("Document notes"), { target: { value: "Branding reference" } });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    expect(await screen.findByText("Crew Name Ideas")).toBeInTheDocument();
    expect(screen.getByText("Branding reference")).toBeInTheDocument();
  });

  it("previews and applies only strong automatic profile links", async () => {
    mocks.listAll.mockResolvedValue({ documents: [{
      ...documentFixture(),
      id: "contract-1",
      displayName: "Big E Contract 2026 Signed",
      originalFilename: "Big E Contract 2026 Signed.pdf",
      category: "contract",
    }] });
    mocks.searchProfiles.mockResolvedValue([
      { id: "profile-1", name: "Big E", city: "West Springfield", region: "MA" },
    ]);
    render(<BusinessDocumentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Find strong matches" }));
    expect(await screen.findByText("Found 1 strong match. Review it before linking.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Link 1 strong matches" }));

    await waitFor(() => expect(mocks.linkProfile).toHaveBeenCalledWith(
      "contract-1",
      "profile-1",
      expect.objectContaining({ confidence: 0.98 }),
    ));
    expect(mocks.searchProfiles).toHaveBeenCalledWith("Big E");
  });

  it("lets an owner search for and manually link a profile while editing", async () => {
    mocks.listAll.mockResolvedValue({ documents: [documentFixture()] });
    mocks.searchProfiles.mockResolvedValue([
      { id: "profile-1", name: "Big E", city: "West Springfield", region: "MA" },
    ]);
    render(<BusinessDocumentsPage />);

    await screen.findByLabelText("Operational Templates folder");
    openFolder("Operational Templates");
    openFolder("2026");
    openFolder("Needs Sorting");
    fireEvent.click(screen.getByRole("button", { name: "Edit Pirate Names" }));
    fireEvent.change(screen.getByLabelText("Find a profile to link"), { target: { value: "Big E" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("option", { name: /Big E/ }));
    fireEvent.click(screen.getByRole("button", { name: "Link selected profile" }));

    await waitFor(() => expect(mocks.linkProfile).toHaveBeenCalledWith("template-1", "profile-1"));
  });

  it("deletes a confirmed document and removes it from the active library", async () => {
    mocks.listAll.mockResolvedValue({ documents: [documentFixture()] });
    mocks.deleteDocument.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BusinessDocumentsPage />);

    await screen.findByLabelText("Operational Templates folder");
    openFolder("Operational Templates");
    openFolder("2026");
    openFolder("Needs Sorting");
    fireEvent.click(await screen.findByRole("button", { name: "Delete Pirate Names" }));

    await waitFor(() => expect(screen.queryByText("Pirate Names")).not.toBeInTheDocument());
    expect(screen.getByText("No business documents yet")).toBeVisible();
    expect(confirm).toHaveBeenCalledWith("Delete Pirate Names.docx? This removes it from the active library.");
  });
});
