import type {
  PieceCondition,
  YearEndInspectionEntryState,
  YearEndInspectionStatus,
} from "@workspace/db/year-end-inspection-schema";

export type InspectionMaintenanceItem = {
  id: string;
  state: "open" | "resolved";
  followUpNotes: string | null;
  resolutionNotes: string | null;
  createdAt: Date;
  createdBy: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
};

export type InspectionEntryRecord = {
  id: string;
  clientMutationId: string;
  inspectionId: string;
  pieceId: string;
  pieceCodeSnapshot: string;
  pieceNameSnapshot: string;
  resourceIdSnapshot: string | null;
  resourceNameSnapshot: string | null;
  sortOrder: number;
  entryState: YearEndInspectionEntryState;
  condition: PieceCondition | null;
  inspectionNotes: string | null;
  repairNeeded: boolean;
  repairNotes: string | null;
  retainForFutureUse: boolean;
  inspectedAt: Date | null;
  inspectorIdentitySnapshot: string | null;
  updatedAt: Date;
  maintenanceItem: InspectionMaintenanceItem | null;
};

export type InspectionProgress = {
  total: number;
  notStarted: number;
  inspected: number;
  notPresent: number;
  needsAttention: number;
  percentComplete: number;
};

export type InspectionDetail = {
  id: string;
  clientMutationId: string;
  legId: string;
  inspectionYear: number;
  status: YearEndInspectionStatus;
  copiedFromInspectionId: string | null;
  managerIdentitySnapshot: string | null;
  overallNotes: string | null;
  adminFollowUpNote: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  archivedAt: Date | null;
  entries: InspectionEntryRecord[];
  progress: InspectionProgress;
};

export type InspectionEntryPatch = Partial<Pick<
  InspectionEntryRecord,
  "pieceCodeSnapshot" | "pieceNameSnapshot" | "entryState" | "condition" | "inspectionNotes" | "repairNeeded" | "repairNotes" | "retainForFutureUse"
>>;

export type InspectionResourceAssignment =
  | { mode: "none" }
  | { mode: "existing"; resourceId: string }
  | { mode: "new"; resourceId: string; name: string };

export type InspectionEntryUpdate = InspectionEntryPatch & {
  resourceAssignment?: InspectionResourceAssignment;
};
