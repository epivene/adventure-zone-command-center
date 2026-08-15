export type EditFollowUpInput = {
  followUpId: string;
  kind: string;
  dueAt: Date | string;
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

export type FollowUpMutationResult =
  | { ok: true; followUp: FollowUpRecord }
  | { ok: false; error: string };
