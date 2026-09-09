import type {
  CommunicationTemplateAccess,
  CommunicationTemplateChannel,
  CommunicationTemplateCreatedByKind,
  CommunicationTemplateBodyFormat,
  CommunicationTemplateOwnerKind,
  CommunicationTemplateState,
} from "@workspace/db/business-source-schema";

export const allowedTemplatePlaceholders = [
  "contactName",
  "profileName",
  "eventName",
  "eventLocation",
  "eventCity",
  "eventState",
  "eventDates",
  "senderName",
  "senderPhone",
  "senderEmail",
  "packageName",
  "packagePrice",
  "packageDuration",
  "followUpDate",
  "conventionName",
  "additionalInsuredWording",
  "additionalInsuredInfo",
  "personalNote",
  "earlyBirdDeadline",
] as const;

export type TemplatePlaceholder =
  (typeof allowedTemplatePlaceholders)[number];

export type CommunicationTemplateSeed = {
  code: string;
  templateVersion?: string | null;
  name: string;
  channel: CommunicationTemplateChannel;
  category: string;
  accessScope: CommunicationTemplateAccess;
  state: CommunicationTemplateState;
  subjectTemplate: string | null;
  requiredPlaceholders: readonly TemplatePlaceholder[];
  bodyTemplate: string;
  bodyFormat?: CommunicationTemplateBodyFormat;
  sourceNote?: string;
  reviewedBy?: string;
};

export type CommunicationTemplateRecord = {
  id: string;
  code: string;
  templateVersion: string | null;
  name: string;
  channel: CommunicationTemplateChannel;
  category: string;
  accessScope: CommunicationTemplateAccess;
  state: CommunicationTemplateState;
  subjectTemplate: string | null;
  bodyTemplate: string;
  bodyFormat: CommunicationTemplateBodyFormat;
  allowedPlaceholders: TemplatePlaceholder[];
  requiredPlaceholders: TemplatePlaceholder[];
  ownerKind: CommunicationTemplateOwnerKind;
  ownerOfficeAccountId: string | null;
  createdByKind: CommunicationTemplateCreatedByKind;
  createdById: string | null;
  sourceTemplateId: string | null;
  sourceDocumentId: string | null;
  sourceNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  updatedAt: Date;
};

export type TemplateRenderValues = Partial<
  Record<TemplatePlaceholder, string | null | undefined>
>;

export type RenderedCommunicationTemplate = {
  templateId: string;
  subject: string;
  body: string;
  bodyFormat: CommunicationTemplateBodyFormat;
  missingRequiredFields: TemplatePlaceholder[];
};
