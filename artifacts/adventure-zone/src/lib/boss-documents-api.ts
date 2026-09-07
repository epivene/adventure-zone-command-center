import { bossGet } from "@/lib/boss-auth-context";

export type BossContractDocument = {
  id: string;
  documentId?: string | null;
  projectId: string;
  projectName: string;
  projectStatus: string;
  outputStatus: string;
  contractState: string;
  fileUrl: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type BossCertificateDocument = {
  id: string;
  documentId: string | null;
  officeAccountId: string | null;
  officeAccountName?: string;
  name: string;
  assetId: string | null;
  assetName?: string | null;
  bookingId: string | null;
  bookingName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  reviewState: "reviewed" | "needs_review";
  expirationState: "current" | "expiring_soon" | "expired" | "incomplete";
  fileAvailable: boolean;
  fileUrl: string | null;
  createdAt: string;
  updatedAt: string;
  legacyRecord?: boolean;
};

export type BossEmailDocument = {
  id: string;
  organizationId: string;
  organizationName: string;
  contactId: string;
  contactName: string;
  recipientEmail: string;
  subject: string;
  state: "draft" | "submitted" | "needs_changes" | "sending" | "sent";
  coordinatorNote: string | null;
  ownerReturnNote: string | null;
  submittedAt: string | null;
  sentAt: string | null;
  updatedAt: string;
};

export type BossDocumentsResponse = {
  contracts: BossContractDocument[];
  certificates: BossCertificateDocument[];
  emailDrafts: BossEmailDocument[];
  libraryDocuments?: Array<{
    documentId: string;
    category: "coi" | "contract" | "operational_template";
    name: string;
    fileAvailable: boolean;
  }>;
  workspaceAvailable: boolean;
};

export const bossDocumentsApi = {
  list: () => bossGet<BossDocumentsResponse>("/boss/documents"),
};
