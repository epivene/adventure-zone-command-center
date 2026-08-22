import type {
  CommunicationTemplateAccess,
  CommunicationTemplateChannel,
  CommunicationTemplateState,
} from "@workspace/db/business-source-schema";

export const allowedTemplatePlaceholders = [
  "contactName",
  "eventName",
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
] as const;

export type TemplatePlaceholder =
  (typeof allowedTemplatePlaceholders)[number];

export type CommunicationTemplateSeed = {
  code: string;
  name: string;
  channel: CommunicationTemplateChannel;
  category: string;
  accessScope: CommunicationTemplateAccess;
  state: CommunicationTemplateState;
  subjectTemplate: string | null;
  requiredPlaceholders: readonly TemplatePlaceholder[];
  bodyTemplate: string;
};

export type CommunicationTemplateRecord = {
  id: string;
  code: string;
  name: string;
  channel: CommunicationTemplateChannel;
  category: string;
  accessScope: CommunicationTemplateAccess;
  state: CommunicationTemplateState;
  subjectTemplate: string | null;
  bodyTemplate: string;
  allowedPlaceholders: TemplatePlaceholder[];
  requiredPlaceholders: TemplatePlaceholder[];
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
  missingRequiredFields: TemplatePlaceholder[];
};
