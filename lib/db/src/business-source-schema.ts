import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const businessSourceAccessValues = [
  "owner",
  "office",
  "manager",
  "public_template",
] as const;
export type BusinessSourceAccess = (typeof businessSourceAccessValues)[number];

export const businessSourceReviewStateValues = [
  "unreviewed",
  "reviewed",
  "superseded",
  "archived",
] as const;
export type BusinessSourceReviewState =
  (typeof businessSourceReviewStateValues)[number];

export const businessSourceFactReviewStateValues = [
  "proposed",
  "approved",
  "conflict",
  "rejected",
  "superseded",
] as const;
export type BusinessSourceFactReviewState =
  (typeof businessSourceFactReviewStateValues)[number];

export const communicationTemplateStateValues = [
  "draft",
  "reviewed",
  "active",
  "archived",
] as const;
export type CommunicationTemplateState =
  (typeof communicationTemplateStateValues)[number];

export const communicationTemplateAccessValues = ["owner", "office"] as const;
export type CommunicationTemplateAccess =
  (typeof communicationTemplateAccessValues)[number];

export const communicationTemplateChannelValues = [
  "email",
  "internal_email",
] as const;
export type CommunicationTemplateChannel =
  (typeof communicationTemplateChannelValues)[number];

export const businessSourceDocuments = pgTable(
  "business_source_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    originalFilename: text("original_filename").notNull(),
    displayTitle: text("display_title").notNull(),
    sourceCategory: text("source_category").notNull(),
    effectiveYear: integer("effective_year"),
    accessScope: text("access_scope")
      .$type<BusinessSourceAccess>()
      .default("owner")
      .notNull(),
    reviewState: text("review_state")
      .$type<BusinessSourceReviewState>()
      .default("unreviewed")
      .notNull(),
    storageReference: text("storage_reference"),
    notes: text("notes"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("business_source_documents_filename_unique").on(
      table.originalFilename,
    ),
    index("business_source_documents_category_review_idx").on(
      table.sourceCategory,
      table.reviewState,
    ),
    check(
      "business_source_documents_access_valid",
      sql`${table.accessScope} in ('owner','office','manager','public_template')`,
    ),
    check(
      "business_source_documents_review_valid",
      sql`${table.reviewState} in ('unreviewed','reviewed','superseded','archived')`,
    ),
  ],
);

export const businessSourceFactReviews = pgTable(
  "business_source_fact_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => businessSourceDocuments.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    entityKind: text("entity_kind").notNull(),
    entityKey: text("entity_key"),
    proposedValue: text("proposed_value").notNull(),
    normalizedValue: text("normalized_value"),
    sourceLocator: text("source_locator").notNull(),
    reviewState: text("review_state")
      .$type<BusinessSourceFactReviewState>()
      .default("proposed")
      .notNull(),
    conflictGroup: text("conflict_group"),
    reviewer: text("reviewer"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("business_source_fact_reviews_identity_unique").on(
      table.sourceDocumentId,
      table.factKey,
      table.sourceLocator,
    ),
    index("business_source_fact_reviews_conflict_idx").on(
      table.reviewState,
      table.conflictGroup,
    ),
    index("business_source_fact_reviews_entity_idx").on(
      table.entityKind,
      table.entityKey,
    ),
    check(
      "business_source_fact_reviews_state_valid",
      sql`${table.reviewState} in ('proposed','approved','conflict','rejected','superseded')`,
    ),
  ],
);

export const communicationTemplates = pgTable(
  "communication_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    channel: text("channel")
      .$type<CommunicationTemplateChannel>()
      .default("email")
      .notNull(),
    category: text("category").notNull(),
    subjectTemplate: text("subject_template"),
    bodyTemplate: text("body_template").notNull(),
    allowedPlaceholders: text("allowed_placeholders")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    requiredPlaceholders: text("required_placeholders")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    accessScope: text("access_scope")
      .$type<CommunicationTemplateAccess>()
      .default("owner")
      .notNull(),
    state: text("state")
      .$type<CommunicationTemplateState>()
      .default("draft")
      .notNull(),
    sourceDocumentId: uuid("source_document_id").references(
      () => businessSourceDocuments.id,
      { onDelete: "set null" },
    ),
    sourceNote: text("source_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("communication_templates_code_unique").on(table.code),
    index("communication_templates_state_access_category_idx").on(
      table.state,
      table.accessScope,
      table.category,
    ),
    check(
      "communication_templates_channel_valid",
      sql`${table.channel} in ('email','internal_email')`,
    ),
    check(
      "communication_templates_access_valid",
      sql`${table.accessScope} in ('owner','office')`,
    ),
    check(
      "communication_templates_state_valid",
      sql`${table.state} in ('draft','reviewed','active','archived')`,
    ),
  ],
);
