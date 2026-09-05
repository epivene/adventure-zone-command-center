import { bossGet } from "@/lib/boss-auth-context";

export type BossContractDocument = {
  id: string;
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
  name: string;
  altText: string | null;
  scope: string;
  mimeType: string | null;
  projectId: string | null;
  bookingId: string | null;
  bookingName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  reviewState: "reviewed" | "needs_review";
  expirationState: "not_recorded";
  expiresAt: null;
  fileUrl: string | null;
  createdAt: string;
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
  workspaceAvailable: boolean;
};

export const bossDocumentsApi = {
  list: () => bossGet<BossDocumentsResponse>("/boss/documents"),
};