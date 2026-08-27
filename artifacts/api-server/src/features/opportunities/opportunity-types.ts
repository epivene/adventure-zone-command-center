import type {
  OpportunityPriority as DatabaseOpportunityPriority,
  OpportunityStatus as DatabaseOpportunityStatus,
} from "@/db/schema";

export {
  opportunityPriorityValues,
  opportunityStatusValues,
} from "@/db/schema";

export type OpportunityStatus = DatabaseOpportunityStatus;
export type OpportunityPriority = DatabaseOpportunityPriority;

export type OpportunityRecord = {
  id: string;
  organizationId: string;
  eventYear: number;
  bookingId: string | null;
  contactId: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  nextActionKind: string | null;
  nextActionDueAt: Date | null;
  holdReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateOpportunityInput = {
  organizationId: string;
  eventYear: number;
  bookingId?: string | null;
  contactId?: string | null;
  status?: OpportunityStatus;
  priority?: OpportunityPriority;
  nextActionKind?: string | null;
  nextActionDueAt?: Date | null;
  holdReason?: string | null;
};

export type UpdateOpportunityInput = {
  bookingId?: string | null;
  contactId?: string | null;
  status?: OpportunityStatus;
  priority?: OpportunityPriority;
  nextActionKind?: string | null;
  nextActionDueAt?: Date | null;
  holdReason?: string | null;
};

export type QueueOverride = {
  opportunityId: string;
  businessDate: string;
  pinned: boolean;
  manualOrder: number | null;
  snoozedUntil: Date | null;
};
