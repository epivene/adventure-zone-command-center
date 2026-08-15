import { activityKindValues } from "@/db/schema";
import type { PersistedCallDisposition } from "@/features/calls/call-types";

export type ActivityKind = (typeof activityKindValues)[number];

export type ActivityParent = {
  organizationId?: string;
  contactId?: string;
  bookingId?: string;
};

export type CreateActivityInput = ActivityParent & {
  kind: ActivityKind;
  body: string;
  occurredAt: Date;
};

export type EditActivityInput = {
  activityId: string;
  body: string;
  reason: string;
  callOutcome?: PersistedCallDisposition;
};

export type ActivityTimelineItem = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  kind: ActivityKind;
  body: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  revisionCount: number;
  callOutcome: PersistedCallDisposition | null;
  hasLinkedCallSession: boolean;
};

export type ActivityRevision = {
  id: string;
  activityId: string;
  priorBody: string;
  replacementBody: string;
  reason: string | null;
  createdAt: Date;
};

export type ActivityTimelinePage = {
  items: ActivityTimelineItem[];
  nextPage: number | null;
};

export type ActivityRevisionPage = {
  revisions: ActivityRevision[];
  nextPage: number | null;
};

export type ActivityError =
  | { code: "ACTIVITY_NOT_FOUND" }
  | { code: "INVALID_ACTIVITY_INPUT"; message: string };
