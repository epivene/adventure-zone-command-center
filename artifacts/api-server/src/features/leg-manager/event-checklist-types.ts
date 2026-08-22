import type {
  ChecklistFollowUpSyncState,
  ChecklistPhase,
  ChecklistResult,
  ChecklistRunState,
} from "@workspace/db/event-checklist-schema";

export type EventChecklistView = {
  id: string;
  bookingId: string;
  legId: string;
  phase: ChecklistPhase;
  state: ChecklistRunState;
  startedAt: string;
  completedAt: string | null;
  unableReason: string | null;
  items: Array<{
    resultId: string;
    itemCode: string;
    label: string;
    scope: "site" | "resource";
    resourceId: string | null;
    resourceName: string | null;
    safetyCritical: boolean;
    result: ChecklistResult | null;
    note: string | null;
    photoCount: number;
    followUpSyncState: ChecklistFollowUpSyncState;
  }>;
};
