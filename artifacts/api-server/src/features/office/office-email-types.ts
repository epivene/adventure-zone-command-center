import type { OfficeEmailState } from "@/db/schema";

export type OfficeEmailDraftView = {
  id: string;
  organizationId: string;
  contactId: string;
  bookingId: string | null;
  eventYear: number | null;
  communicationTemplateId: string | null;
  recipientEmail: string;
  subject: string;
  body: string;
  coordinatorNote: string | null;
  state: OfficeEmailState;
  submittedAt: string | null;
  ownerReturnNote: string | null;
  sentAt: string | null;
  updatedAt: string;
};
