import { describe, expect, it } from "vitest";
import type { BusinessDocumentRecord } from "@/lib/business-documents-api";
import { groupBusinessDocuments } from "./business-document-organization";

describe("business document organization", () => {
  it("shows invoices as their own document group", () => {
    const document = {
      id: "invoice-1",
      displayName: "BBQ Days Invoice",
      originalFilename: "invoice.pdf",
      category: "invoice",
      lifecycle: "active",
      reviewState: "accepted",
      currentVersionId: null,
      effectiveDate: null,
      issueDate: "2026-09-15",
      expirationDate: null,
      notes: null,
      sourceKinds: ["manual"],
      createdAt: "2026-09-15T12:00:00Z",
      updatedAt: "2026-09-15T12:00:00Z",
      fileAvailable: true,
      links: [],
    } satisfies BusinessDocumentRecord;
    expect(groupBusinessDocuments([document])[0]).toMatchObject({ key: "invoice", label: "Invoices" });
  });
});
