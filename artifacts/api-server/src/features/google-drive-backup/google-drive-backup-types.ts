import type { BusinessDocumentCategory } from "@workspace/db";

export type ProfileBackupKind = "profile_summary" | "follow_up_summary";

export interface ProfilePathInput {
  organizationId: string;
  displayName: string;
  kind: ProfileBackupKind;
}

export interface DocumentPathInput {
  documentId: string;
  displayName: string;
  originalFilename: string;
  category: BusinessDocumentCategory;
  organizationId?: string | null;
  organizationName?: string | null;
  explicitYear?: number | null;
  effectiveDate?: string | Date | null;
  bookingStartsAt?: string | Date | null;
  issueDate?: string | Date | null;
  createdAt?: string | Date | null;
}

export interface ResolvedBackupPath {
  directories: readonly string[];
  fileName: string;
  logicalPath: string;
}


export interface LabeledValue {
  label: string;
  value: string;
}

export interface BookingBackupSummary {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  location: string;
}

export interface ActivityBackupSummary {
  id: string;
  kind: string;
  title: string;
  occurredAt: string;
}

export interface EmailBackupSummary {
  messageId: string;
  occurredAt: string;
  sender: string;
  subject: string;
  summary: string;
  appUrl: string;
}

export interface FollowUpBackupSummary {
  id: string;
  kind: string;
  dueAt: string;
  completedAt: string | null;
  outcome: string | null;
  bookingName: string | null;
}

export interface ProfileBackupSnapshot {
  profileId: string;
  displayName: string;
  contactDetails: readonly LabeledValue[];
  bookings: readonly BookingBackupSummary[];
  recentActivity: readonly ActivityBackupSummary[];
  emailSummaries: readonly EmailBackupSummary[];
  appUrl: string;
  generatedAt: Date;
  sourceVersion: string;
}

export interface FollowUpBackupSnapshot {
  profileId: string;
  displayName: string;
  open: readonly FollowUpBackupSummary[];
  scheduled: readonly FollowUpBackupSummary[];
  completedRecent: readonly FollowUpBackupSummary[];
  appUrl: string;
  generatedAt: Date;
  sourceVersion: string;
}
