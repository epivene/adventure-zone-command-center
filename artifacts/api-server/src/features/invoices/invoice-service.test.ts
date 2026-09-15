import { describe, expect, it, vi } from "vitest";

import { InvoiceService } from "./invoice-service";

function repository() {
  return {
    bookingOrganizationId: vi.fn().mockResolvedValue("profile-b"),
    documentCategory: vi.fn().mockResolvedValue("invoice"),
    findActiveNumber: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    detail: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    recordPayment: vi.fn(),
    voidPayment: vi.fn(),
  };
}

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  bookingId: "22222222-2222-4222-8222-222222222222",
  documentId: "33333333-3333-4333-8333-333333333333",
  invoiceNumber: "AZ-2027-001",
  status: "sent" as const,
  totalCents: 750_000,
  depositCents: 300_000,
  issueDate: "2026-09-15",
  depositDueDate: "2026-10-15",
  balanceDueDate: "2027-09-03",
  notes: null,
};

describe("InvoiceService", () => {
  it("rejects a booking that does not belong to the selected profile", async () => {
    const repo = repository();
    const service = new InvoiceService(repo);
    await expect(service.create(input, "owner:test", new Date("2026-09-15T12:00:00Z")))
      .rejects.toMatchObject({ code: "INVOICE_BOOKING_PROFILE_MISMATCH" });
  });

  it("rejects a non-invoice document", async () => {
    const repo = repository();
    repo.bookingOrganizationId.mockResolvedValue(input.organizationId);
    repo.documentCategory.mockResolvedValue("contract");
    const service = new InvoiceService(repo);
    await expect(service.create(input, "owner:test", new Date()))
      .rejects.toMatchObject({ code: "INVOICE_DOCUMENT_INVALID" });
  });

  it("rejects duplicate active invoice numbers for one profile", async () => {
    const repo = repository();
    repo.bookingOrganizationId.mockResolvedValue(input.organizationId);
    repo.findActiveNumber.mockResolvedValue({ id: "existing" });
    const service = new InvoiceService(repo);
    await expect(service.create(input, "owner:test", new Date()))
      .rejects.toMatchObject({ code: "INVOICE_NUMBER_EXISTS" });
  });
});
