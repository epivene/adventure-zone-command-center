import { describe, expect, it } from "vitest";
import { enrichAdminExpenseRecord } from "./admin-finance-record-service";
import type { AdminExpenseRow } from "./admin-finance-types";

const row: AdminExpenseRow = {
  id: "11111111-1111-4111-8111-111111111111", legId: "22222222-2222-4222-8222-222222222222", legName: "Leg 1", submitterName: "Kristy",
  bookingId: null, bookingName: null, tripId: null, tripSegmentId: null, assignmentSource: "unassigned", assignmentReason: null,
  assignmentUpdatedAt: new Date("2026-08-18T01:00:00Z"), merchant: "Fuel Stop", category: "fuel", amountCents: 4200, taxCents: 100,
  paymentSource: "adventure_zone_debit", occurredAt: new Date("2026-08-18T01:00:00Z"), notes: "Travel fuel", employeeNote: null,
  createdAt: new Date("2026-08-18T01:01:00Z"), updatedAt: new Date("2026-08-18T01:01:00Z"),
  receiptId: "33333333-3333-4333-8333-333333333333", receiptObjectKey: "receipts/example.jpg", receiptImageStatus: "image_uploaded",
  receiptMimeType: "image/jpeg", receiptCreatedAt: new Date("2026-08-18T01:01:00Z"),
};

describe("admin finance receipt evidence", () => {
  it("keeps the manager submission and signed receipt together", async () => {
    const record = await enrichAdminExpenseRecord(row, [], { put: async () => undefined, getSignedReadUrl: async () => "https://signed.example/receipt" });
    expect(record.submitterName).toBe("Kristy");
    expect(record.totalCents).toBe(4300);
    expect(record.receipt?.imageUrl).toBe("https://signed.example/receipt");
  });
  it("keeps the expense visible when signed receipt access fails", async () => {
    const record = await enrichAdminExpenseRecord(row, [], { put: async () => undefined, getSignedReadUrl: async () => { throw new Error("storage down"); } });
    expect(record.id).toBe(row.id);
    expect(record.receipt?.imageUrl).toBeNull();
    expect(record.warning).toBe("receipt_image_unavailable");
  });
});
