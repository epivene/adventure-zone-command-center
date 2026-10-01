export type AttentionState =
  "needs_your_reply" | "waiting_for_their_reply" | "resolved";
export type AttentionRecord = {
  id: string;
  gmailConnectionId: string;
  threadId: string;
  profileId: string;
  eventYear: number | null;
  state: AttentionState;
  reason: string;
  subject: string;
  dueAt: string | null;
  followupId: string | null;
  reviewedMessageId: string;
  revision: string;
  actorId: string;
  createdAt: string;
  updatedAt: string;
};
export type AttentionPreview = {
  id: string;
  ownerId: string;
  connectorId: string | null;
  gmailConnectionId: string;
  threadId: string;
  latestMessageId: string;
  profileId: string;
  eventYear: number | null;
  state: AttentionState;
  reason: string;
  subject: string;
  dueAt: string | null;
  followupId: string | null;
  expectedRevision: string | null;
  sourceFingerprint: string;
  expiresAt: string;
};
export type AttentionActor = { ownerId: string; connectorId: string | null };
