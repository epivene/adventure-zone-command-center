import type { LegManagerObjectStorage } from "./leg-manager-object-storage";
import type { AdminExpenseRow, FinanceAuditView, FinanceAssignmentSource } from "./admin-finance-types";

export type AdminExpenseRecord = {
  id: string; legId: string; legName: string; submitterName: string | null;
  bookingId: string | null; bookingName: string | null; tripId: string | null; tripSegmentId: string | null;
  assignmentSource: FinanceAssignmentSource; assignmentReason: string | null;
  merchant: string | null; category: string; amountCents: number; taxCents: number; totalCents: number;
  paymentSource: string; occurredAt: string; notes: string | null; employeeNote: string | null;
  submittedAt: string; updatedAt: string;
  receipt: null | { id: string; imageStatus: string; mimeType: string | null; imageUrl: string | null };
  audit: Array<{ id: string; actorId: string | null; actorLabel: string; changeReason: string | null; previousValues: Record<string, unknown>; newValues: Record<string, unknown>; changedAt: string }>;
  warning?: "receipt_image_unavailable";
};

export async function enrichAdminExpenseRecord(row: AdminExpenseRow, audit: FinanceAuditView[], storage: LegManagerObjectStorage): Promise<AdminExpenseRecord> {
  let warning: AdminExpenseRecord["warning"];
  let imageUrl: string | null = null;
  if (row.receiptId && row.receiptImageStatus === "image_uploaded" && row.receiptObjectKey) {
    try { imageUrl = await storage.getSignedReadUrl(row.receiptObjectKey, 15 * 60); }
    catch { warning = "receipt_image_unavailable"; }
  }
  return {
    id: row.id, legId: row.legId, legName: row.legName, submitterName: row.submitterName,
    bookingId: row.bookingId, bookingName: row.bookingName, tripId: row.tripId, tripSegmentId: row.tripSegmentId,
    assignmentSource: row.assignmentSource, assignmentReason: row.assignmentReason,
    merchant: row.merchant, category: row.category, amountCents: row.amountCents, taxCents: row.taxCents,
    totalCents: row.amountCents + row.taxCents, paymentSource: row.paymentSource, occurredAt: row.occurredAt.toISOString(),
    notes: row.notes, employeeNote: row.employeeNote, submittedAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    receipt: row.receiptId ? { id: row.receiptId, imageStatus: row.receiptImageStatus ?? "image_pending", mimeType: row.receiptMimeType, imageUrl } : null,
    audit: audit.map((entry) => ({ ...entry, changedAt: entry.changedAt.toISOString() })),
    ...(warning ? { warning } : {}),
  };
}

export async function enrichAdminExpenseRecords(rows: AdminExpenseRow[], auditByExpense: Map<string, FinanceAuditView[]>, storage: LegManagerObjectStorage) {
  return Promise.all(rows.map((row) => enrichAdminExpenseRecord(row, auditByExpense.get(row.id) ?? [], storage)));
}
