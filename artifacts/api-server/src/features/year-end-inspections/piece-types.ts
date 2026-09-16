import type { PieceLifecycleStatus } from "@workspace/db/year-end-inspection-schema";

export type PieceAssignmentHistory = {
  id: string;
  resourceId: string;
  resourceName: string;
  assignedAt: Date;
  removedAt: Date | null;
  actorId: string;
  reason: string | null;
};

export type PieceInventoryRecord = {
  id: string;
  code: string;
  name: string;
  pieceType: string;
  currentLegId: string | null;
  storageLocation: string | null;
  identityNotes: string | null;
  lifecycleStatus: PieceLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  currentResourceId: string | null;
  currentResourceName: string | null;
  assignmentHistory: PieceAssignmentHistory[];
};
