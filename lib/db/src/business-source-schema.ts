import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  bookings,
  organizationLocations,
  organizations,
  packageTemplates,
} from "./schema";

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

export const communicationTemplateOwnerKindValues = [
  "company",
  "shared_office",
  "office_user",
] as const;
export type CommunicationTemplateOwnerKind =
  (typeof communicationTemplateOwnerKindValues)[number];

export const communicationTemplateCreatedByKindValues = [
  "system",
  "owner",
  "office_user",
] as const;
export type CommunicationTemplateCreatedByKind =
  (typeof communicationTemplateCreatedByKindValues)[number];

export const communicationTemplateChannelValues = [
  "email",
  "internal_email",
] as const;
export type CommunicationTemplateChannel =
  (typeof communicationTemplateChannelValues)[number];

export const communicationTemplateBodyFormatValues = ["plain_text", "html"] as const;
export type CommunicationTemplateBodyFormat =
  (typeof communicationTemplateBodyFormatValues)[number];

export const sourceDocumentLinkKindValues = [
  "profile",
  "location",
  "booking",
  "package_reference",
] as const;
export type SourceDocumentLinkKind =
  (typeof sourceDocumentLinkKindValues)[number];

export const historicalTermValueTypeValues = [
  "text",
  "money_cents",
  "date",
  "date_range",
  "integer",
  "boolean",
] as const;
export type HistoricalTermValueType =
  (typeof historicalTermValueTypeValues)[number];

export const historicalTermReviewStateValues = [
  "proposed",
  "approved",
  "rejected",
] as const;
export type HistoricalTermReviewState =
  (typeof historicalTermReviewStateValues)[number];

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

export const businessSourceDocumentFiles = pgTable(
  "business_source_document_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => businessSourceDocuments.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    originalSizeBytes: bigint("original_size_bytes", { mode: "number" }).notNull(),
    sha256Hex: text("sha256_hex").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("business_source_document_files_document_unique").on(
      table.sourceDocumentId,
    ),
    uniqueIndex("business_source_document_files_storage_key_unique").on(
      table.storageKey,
    ),
    check(
      "business_source_document_files_size_nonnegative",
      sql`${table.originalSizeBytes} >= 0`,
    ),
    check(
      "business_source_document_files_sha256_hex_valid",
      sql`${table.sha256Hex} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const businessSourceDocumentLinks = pgTable(
  "business_source_document_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => businessSourceDocuments.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    organizationLocationId: uuid("organization_location_id").references(
      () => organizationLocations.id,
      { onDelete: "set null" },
    ),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    packageTemplateId: uuid("package_template_id").references(
      () => packageTemplates.id,
      { onDelete: "set null" },
    ),
    linkKind: text("link_kind").$type<SourceDocumentLinkKind>().notNull(),
    linkNote: text("link_note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("business_source_document_links_profile_unique")
      .on(table.sourceDocumentId, table.organizationId)
      .where(sql`${table.organizationId} is not null`),
    uniqueIndex("business_source_document_links_location_unique")
      .on(table.sourceDocumentId, table.organizationLocationId)
      .where(sql`${table.organizationLocationId} is not null`),
    uniqueIndex("business_source_document_links_booking_unique")
      .on(table.sourceDocumentId, table.bookingId)
      .where(sql`${table.bookingId} is not null`),
    uniqueIndex("business_source_document_links_package_unique")
      .on(table.sourceDocumentId, table.packageTemplateId)
      .where(sql`${table.packageTemplateId} is not null`),
    index("business_source_document_links_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("business_source_document_links_location_created_idx").on(
      table.organizationLocationId,
      table.createdAt,
    ),
    index("business_source_document_links_booking_created_idx").on(
      table.bookingId,
      table.createdAt,
    ),
    check(
      "business_source_document_links_kind_valid",
      sql`${table.linkKind} in ('profile','location','booking','package_reference')`,
    ),
    check(
      "business_source_document_links_exactly_one_target",
      sql`(
        (${table.organizationId} is not null)::int +
        (${table.organizationLocationId} is not null)::int +
        (${table.bookingId} is not null)::int +
        (${table.packageTemplateId} is not null)::int
      ) = 1`,
    ),
  ],
);

export const businessSourceHistoricalTerms = pgTable(
  "business_source_historical_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => businessSourceDocuments.id, { onDelete: "cascade" }),
    documentLinkId: uuid("document_link_id").references(
      () => businessSourceDocumentLinks.id,
      { onDelete: "set null" },
    ),
    termKey: text("term_key").notNull(),
    label: text("label").notNull(),
    valueText: text("value_text").notNull(),
    valueType: text("value_type").$type<HistoricalTermValueType>().notNull(),
    sourceLocator: text("source_locator").notNull(),
    reviewState: text("review_state")
      .$type<HistoricalTermReviewState>()
      .default("proposed")
      .notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("business_source_historical_terms_identity_unique").on(
      table.sourceDocumentId,
      table.termKey,
      table.sourceLocator,
    ),
    index("business_source_historical_terms_document_review_idx").on(
      table.sourceDocumentId,
      table.reviewState,
    ),
    check(
      "business_source_historical_terms_value_type_valid",
      sql`${table.valueType} in ('text','money_cents','date','date_range','integer','boolean')`,
    ),
    check(
      "business_source_historical_terms_review_valid",
      sql`${table.reviewState} in ('proposed','approved','rejected')`,
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
    templateVersion: text("template_version"),
    name: text("name").notNull(),
    channel: text("channel")
      .$type<CommunicationTemplateChannel>()
      .default("email")
      .notNull(),
    category: text("category").notNull(),
    subjectTemplate: text("subject_template"),
    bodyTemplate: text("body_template").notNull(),
    bodyFormat: text("body_format")
      .$type<CommunicationTemplateBodyFormat>()
      .default("plain_text")
      .notNull(),
    editorDocument: jsonb("editor_document"),
    editorDocumentVersion: integer("editor_document_version"),
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
    ownerKind: text("owner_kind")
      .$type<CommunicationTemplateOwnerKind>()
      .default("company")
      .notNull(),
    ownerOfficeAccountId: uuid("owner_office_account_id"),
    createdByKind: text("created_by_kind")
      .$type<CommunicationTemplateCreatedByKind>()
      .default("system")
      .notNull(),
    createdById: uuid("created_by_id"),
    sourceTemplateId: uuid("source_template_id"),
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
    index("communication_templates_state_owner_kind_idx").on(
      table.state,
      table.ownerKind,
    ),
    index("communication_templates_owner_account_state_idx").on(
      table.ownerOfficeAccountId,
      table.state,
    ),
    index("communication_templates_source_template_idx").on(
      table.sourceTemplateId,
    ),
    check(
      "communication_templates_channel_valid",
      sql`${table.channel} in ('email','internal_email')`,
    ),
    check(
      "communication_templates_body_format_valid",
      sql`${table.bodyFormat} in ('plain_text','html')`,
    ),
    check(
      "communication_templates_editor_document_shape",
      sql`(
        (${table.editorDocument} is null and ${table.editorDocumentVersion} is null)
        or
        (${table.editorDocument} is not null and ${table.editorDocumentVersion} = 1)
      )`,
    ),
    check(
      "communication_templates_access_valid",
      sql`${table.accessScope} in ('owner','office')`,
    ),
    check(
      "communication_templates_state_valid",
      sql`${table.state} in ('draft','reviewed','active','archived')`,
    ),
    check(
      "communication_templates_owner_kind_valid",
      sql`${table.ownerKind} in ('company','shared_office','office_user')`,
    ),
    check(
      "communication_templates_created_by_kind_valid",
      sql`${table.createdByKind} in ('system','owner','office_user')`,
    ),
    check(
      "communication_templates_owner_account_shape_valid",
      sql`(
        (${table.ownerKind} = 'office_user' and ${table.ownerOfficeAccountId} is not null)
        or
        (${table.ownerKind} in ('company','shared_office') and ${table.ownerOfficeAccountId} is null)
      )`,
    ),
  ],
);
