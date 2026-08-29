// Schema consumers must not initialize the database connection as an import side effect.
export * from "@workspace/db/schema";
export * from "@workspace/db/event-family-schema";
export * from "@workspace/db/paper-note-schema";
export * from "@workspace/db/business-source-schema";
export * from "@workspace/db/commercial-offer-schema";
export * from "@workspace/db/event-checklist-schema";
export * from "@workspace/db/resource-source-candidate-schema";
export * from "@workspace/db/event-attendance-history-schema";
export * from "@workspace/db/office-coordinator-schema";
export * from "@workspace/db/google-workspace-schema";
export * from "@workspace/db/operational-calendar-schema";
export * from "@workspace/db/lead-intake-schema";
export * from "@workspace/db/booking-opportunity-schema";
export * from "@workspace/db/booking-opportunity-email-schema";
export * from "@workspace/db/leg-assignment-schema";
export {
  designAssets,
  designOutputs,
  designProjectVersions,
  designProjects,
  designSmartFields,
  designTemplateFavorites,
  designTemplates,
} from "@workspace/db/design-studio-schema";