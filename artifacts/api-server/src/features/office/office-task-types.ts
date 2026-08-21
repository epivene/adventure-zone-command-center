import type { OfficeTaskStatus, OfficeTaskType } from "@/db/schema";

export type OfficeTaskView = {
  id: string;
  type: OfficeTaskType;
  title: string;
  instructions: string | null;
  profile: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  status: Exclude<OfficeTaskStatus, "cancelled">;
  needsHelp: boolean;
  coordinatorNote: string | null;
  dueAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type OwnerOfficeTaskView = OfficeTaskView & {
  officeAccountId: string;
  ownerSortOrder: number;
  cancelled: boolean;
};
