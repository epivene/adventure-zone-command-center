export type CreateFollowUpInput = {
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
};

export type EditFollowUpInput = {
  followUpId: string;
  kind: string;
  dueAt: Date;
  completed: boolean;
  outcome: string | null;
};

export type FollowUpRecord = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  outcome: string | null;
};

export type FollowUpError =
  | { code: "FOLLOW_UP_NOT_FOUND" }
  | { code: "INVALID_FOLLOW_UP_INPUT"; message: string };
