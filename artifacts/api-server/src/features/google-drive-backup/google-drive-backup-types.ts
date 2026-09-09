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
