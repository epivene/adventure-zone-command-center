// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAll: vi.fn(),
  open: vi.fn(),
  upload: vi.fn(),
  archive: vi.fn(),
  delete: vi.fn(),
  deleteDocument: vi.fn(),
  update: vi.fn(),
  reviewItems: vi.fn(),
  searchProfiles: vi.fn(),
  reviewAction: vi.fn(),
}));

vi.mock("@/lib/boss-documents-api", () => ({
  bossBusinessDocumentsApi: mocks,
}));

import BossTemplatesFilesPage from "./BossTemplatesFilesPage";

const document = (overrides: Record<string, unknown>) => ({
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Zebra Contract",
  originalFilename: "zebra-contract.pdf",
  category: "contract",
  lifecycle: "active",
  reviewState: "accepted",
  currentVersionId: "v1",
  effectiveDate: null,
  issueDate: null,
  expirationDate: null,
  notes: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  fileAvailable: true,
  links: [],
  sourceKinds: ["manual"],
  ...overrides,
});

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.listAll.mockResolvedValue({
    documents: [
      document({}),
      document({ id: "22222222-2222-4222-8222-222222222222", displayName: "Alpha COI", originalFilename: "alpha-coi.pdf", category: "coi", createdAt: "2026-01-01T00:00:00.000Z" }),
    ],
  });
  mocks.upload.mockResolvedValue({ outcome: "imported" });
  mocks.reviewItems.mockResolvedValue({ items: [] });
});

describe("BossTemplatesFilesPage", () => {
  it("matches the Admin/Des library layout and controls", async () => {
    render(<BossTemplatesFilesPage />);

    expect(await screen.findByRole("tab", { name: "All Documents" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Contracts" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Vendor Applications" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Templates" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "COIs & Insurance" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Needs Review" })).toBeVisible();
    expect(screen.getByText("Filters")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit Zebra Contract" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete Zebra Contract" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Upload document" })).toBeVisible();
  });

  it("loads Dave's files from the canonical business document library", async () => {
    render(<BossTemplatesFilesPage />);

    expect(await screen.findByText("Zebra Contract")).toBeVisible();
    expect(screen.getByText("Alpha COI")).toBeVisible();
    expect(mocks.listAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Document workspace unavailable")).not.toBeInTheDocument();
  });

  it("lets Dave sort the shared library by document name", async () => {
    render(<BossTemplatesFilesPage />);
    await screen.findByText("Zebra Contract");

    fireEvent.change(screen.getByLabelText("Sort documents"), { target: { value: "name_asc" } });

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Alpha COI", "Zebra Contract"]);
  });

  it("gives Dave his own upload document control", async () => {
    render(<BossTemplatesFilesPage />);
    await screen.findByText("Zebra Contract");
    const file = new File(["document"], "new-contract.pdf", { type: "application/pdf" });

    fireEvent.change(screen.getByLabelText("Choose document to upload"), { target: { files: [file] } });

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(file));
    await waitFor(() => expect(mocks.listAll).toHaveBeenCalledTimes(2));
  });
});
