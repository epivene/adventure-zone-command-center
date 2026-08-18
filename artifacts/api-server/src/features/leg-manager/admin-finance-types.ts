export const financeAssignmentSources = [
  "legacy",
  "explicit",
  "automatic",
  "admin",
  "unassigned",
] as const;

export type FinanceAssignmentSource = (typeof financeAssignmentSources)[number];

export type AdminExpenseFilters = {
  legId?: string | null;
  bookingId?: string | null;
  category?: string | null;
  paymentSource?: string | null;
  assignmentSource?: FinanceAssignmentSource | null;
  receiptStatus?: "attached" | "missing" | "incomplete" | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
};

export type AdminExpenseUpdateInput = {
  merchant?: string | null;
  category?: string;
  amountCents?: number;
  taxCents?: number;
  paymentSource?: string;
  occurredAt?: Date;
  notes?: string | null;
  bookingId?: string | null;
  tripId?: string | null;
  tripSegmentId?: string | null;
  changeReason?: string | null;
};

export type FinanceAuditActor = {
  actorId: string | null;
  actorLabel: string;
};

export type FinanceAuditView = {
  id: string;
  actorId: string | null;
  actorLabel: string;
  changeReason: string | null;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedAt: Date;
};

export type AdminExpenseRow = {
  id: string;
  legId: string;
  legName: string;
  bookingId: string | null;
  bookingName: string | null;
  tripId: string | null;
  tripSegmentId: string | null;
  assignmentSource: FinanceAssignmentSource;
  assignmentReason: string | null;
  assignmentUpdatedAt: Date | null;
  merchant: string | null;
  category: string;
  amountCents: number;
  taxCents: number;
  paymentSource: string;
  occurredAt: Date;
  notes: string | null;
  employeeNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  receiptId: string | null;
  receiptObjectKey: string | null;
  receiptImageStatus: string | null;
  receiptMimeType: string | null;
  receiptCreatedAt: Date | null;
};
