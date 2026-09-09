import { describe, expect, it } from "vitest";
import type { BusinessDocumentRecord } from "@/lib/business-documents-api";
import { groupBusinessDocuments, isMediaDocument } from "./business-document-organization";

function record(overrides: Partial<BusinessDocumentRecord>): BusinessDocumentRecord {
  return {
    id: "document-1",
    displayName: "Document",
    originalFilename: "document.pdf",
    category: "other",
    lifecycle: "active",
    reviewState: "accepted",
    currentVersionId: "v1",
    effectiveDate: null,
    issueDate: null,
    expirationDate: null,
    notes: null,
    sourceKinds: ["drive"],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    fileAvailable: true,
    links: [],
    ...overrides,
  };
}

describe("business document organization", () => {
  it("keeps image and video files in Media while leaving marketing PDFs with documents", () => {
    expect(isMediaDocument(record({ originalFilename: "Big E booth.jpg" }))).toBe(true);
    expect(isMediaDocument(record({ originalFilename: "Pirate show.MOV" }))).toBe(true);
    expect(isMediaDocument(record({ category: "marketing", originalFilename: "Big E flyer.pdf" }))).toBe(false);
  });

  it("groups document versions by type, year, and inferred event", () => {
    const groups = groupBusinessDocuments([
      record({ id: "signed", displayName: "Big E Contract 2026 Signed", originalFilename: "Big E Contract 2026 Signed.pdf", category: "contract", effectiveDate: "2026-09-01" }),
      record({ id: "draft", displayName: "Big E Contract 2026 Draft", originalFilename: "Big E Contract 2026 Draft.docx", category: "contract", effectiveDate: "2026-09-01" }),
      record({ id: "coi", displayName: "County Fair COI", originalFilename: "County Fair COI 2025.pdf", category: "coi", issueDate: "2025-04-02" }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Contracts", "COIs"]);
    expect(groups[0].years[0].year).toBe("2026");
    expect(groups[0].years[0].events).toEqual([
      expect.objectContaining({ label: "Big E", documents: [expect.objectContaining({ id: "draft" }), expect.objectContaining({ id: "signed" })] }),
    ]);
    expect(groups[1].years[0].events[0].label).toBe("County Fair");
  });
});
