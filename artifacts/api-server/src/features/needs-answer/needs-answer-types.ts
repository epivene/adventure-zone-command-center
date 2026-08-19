export type NeedsAnswerStatus = "open" | "resolved";

export type NeedsAnswerContext = {
  organizationId?: string | null;
  contactId?: string | null;
  bookingId?: string | null;
  followUpId?: string | null;
  callSessionId?: string | null;
};

export type NeedsAnswerItem = NeedsAnswerContext & {
  id: string;
  question: string;
  userNote: string | null;
  status: NeedsAnswerStatus;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type CreateNeedsAnswerInput = NeedsAnswerContext & {
  question: string;
  userNote?: string | null;
};

export type ResolveNeedsAnswerInput = {
  resolution: string;
};
