import type { PhotoEllipse } from "@/lib/inspection-photo-annotations";

export type InspectionCondition = "good" | "needs_cleaning" | "minor_repair" | "major_repair" | "replace" | "retired";
export type InspectionEntryState = "not_started" | "inspected" | "not_present";

export type YearEndInspectionEntryDto = {
  id: string;
  pieceId: string;
  pieceCodeSnapshot: string;
  pieceNameSnapshot: string;
  resourceIdSnapshot?: string | null;
  resourceNameSnapshot: string | null;
  entryState: InspectionEntryState;
  condition: InspectionCondition | null;
  inspectionNotes: string | null;
  repairNeeded: boolean;
  repairNotes: string | null;
  retainForFutureUse: boolean;
  photos?: InspectionPhotoDto[];
};

export type InspectionPhotoDto = {
  id: string;
  signedUrl: string;
  description: string | null;
  annotations: { version: 1; ellipses: PhotoEllipse[] };
};

export type InspectionProgressDto = {
  total: number;
  notStarted: number;
  inspected: number;
  notPresent: number;
  needsAttention: number;
  percentComplete: number;
};

export type YearEndInspectionDto = {
  id: string;
  legId: string;
  inspectionYear: number;
  status: "draft" | "in_progress" | "completed";
  copiedFromInspectionId: string | null;
  updatedAt: string;
  completedAt: string | null;
  entries: YearEndInspectionEntryDto[];
  progress: InspectionProgressDto;
};

export type ManagerApi = <T>(path: string, options?: RequestInit) => Promise<T>;

export function progressForEntries(entries: YearEndInspectionEntryDto[]): InspectionProgressDto {
  const notStarted = entries.filter((entry) => entry.entryState === "not_started").length;
  const inspected = entries.filter((entry) => entry.entryState === "inspected").length;
  const notPresent = entries.filter((entry) => entry.entryState === "not_present").length;
  return {
    total: entries.length,
    notStarted,
    inspected,
    notPresent,
    needsAttention: entries.filter((entry) => entry.repairNeeded).length,
    percentComplete: entries.length ? Math.round(((inspected + notPresent) / entries.length) * 100) : 0,
  };
}
