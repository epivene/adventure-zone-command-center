import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { eventFamilies } from "./event-family-schema";
import { officeAccounts } from "./office-coordinator-schema";
import { bookings, organizations } from "./schema";

export const businessDocumentCategoryValues = [
  "contract",
  "invoice",
  "proposal",
  "coi",
  "insurance_policy",
  "w9_tax",
  "permit",
  "vendor_application",
  "inspection",
  "deposit_receipt",
  "operational_template",
  "marketing",
  "other",
] as const;
export type BusinessDocumentCategory =
  (typeof businessDocumentCategoryValues)[number];

export const businessDocumentLifecycleValues = [
  "active",
  "archived",
  "deleted",
] as const;
export type BusinessDocumentLifecycle =
  (typeof businessDocumentLifecycleValues)[number];

export const businessDocumentReviewStateValues = [
  "accepted",
  "needs_review",
  "rejected",
] as const;
export type BusinessDocumentReviewState =
  (typeof businessDocumentReviewStateValues)[number];

export const businessDocumentTargetKindValues = [
  "profile",
  "booking",
  "event_family",
] as const;
export type BusinessDocumentTargetKind =
  (typeof businessDocumentTargetKindValues)[number];

export const businessDocumentSourceKindValues = [
  "manual",
  "gmail",
  "drive",
  "business_source",
  "google_profile_file",
  "design_asset",
  "design_output",
] as const;
export type BusinessDocumentSourceKind =
  (typeof businessDocumentSourceKindValues)[number];

export const businessDocumentReviewKindValues = [
  "classification",
  "relationship",
  "metadata",
  "source_failure",
] as const;
export type BusinessDocumentReviewKind =
  (typeof businessDocumentReviewKindValues)[number];

export const businessDocuments = pgTable(
  "business_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    displayName: text("display_name").notNull(),
    originalFilename: text("original_filename").notNull(),
    category: text("category")
      .$type<BusinessDocumentCategory>()
      .default("other")
      .notNull(),
    lifecycle: text("lifecycle")
      .$type<BusinessDocumentLifecycle>()
      .default("active")
      .notNull(),
    reviewState: text("review_state")
      .$type<BusinessDocumentReviewState>()
      .default("needs_review")
      .notNull(),
    currentVersionId: uuid("current_version_id"),
    effectiveDate: date("effective_date"),
    issueDate: date("issue_date"),
    expirationDate: date("expiration_date"),
    notes: text("notes"),
    visibility: text("visibility").$type<"owner" | "document_access">().default("owner").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("business_documents_category_review_idx").on(table.category, table.reviewState),
    index("business_documents_lifecycle_updated_idx").on(table.lifecycle, table.updatedAt),
    check("business_documents_category_valid", sql`${table.category} in ('contract','invoice','proposal','coi','insurance_policy','w9_tax','permit','vendor_application','inspection','deposit_receipt','operational_template','marketing','other')`),
    check("business_documents_lifecycle_valid", sql`${table.lifecycle} in ('active','archived','deleted')`),
    check("business_documents_review_valid", sql`${table.reviewState} in ('accepted','needs_review','rejected')`),
    check("business_documents_visibility_valid", sql`${table.visibility} in ('owner','document_access')`),
    check("business_documents_dates_valid", sql`${table.issueDate} is null or ${table.expirationDate} is null or ${table.issueDate} <= ${table.expirationDate}`),
  ],
);

export const businessDocumentBlobs = pgTable(
  "business_document_blobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sha256Hex: text("sha256_hex").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    validationState: text("validation_state").$type<"accepted" | "quarantined">().default("accepted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("business_document_blobs_sha256_unique").on(table.sha256Hex),
    unique("business_document_blobs_storage_key_unique").on(table.storageKey),
    check("business_document_blobs_sha256_valid", sql`${table.sha256Hex} ~ '^[0-9a-f]{64}$'`),
    check("business_document_blobs_size_valid", sql`${table.sizeBytes} >= 0`),
    check("business_document_blobs_validation_valid", sql`${table.validationState} in ('accepted','quarantined')`),
  ],
);

export const businessDocumentVersions = pgTable(
  "business_document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull().references(() => businessDocuments.id, { onDelete: "restrict" }),
    blobId: uuid("blob_id").notNull().references(() => businessDocumentBlobs.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    originalFilename: text("original_filename").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("business_document_versions_number_unique").on(table.documentId, table.versionNumber),
    index("business_document_versions_document_created_idx").on(table.documentId, table.createdAt),
    check("business_document_versions_number_positive", sql`${table.versionNumber} > 0`),
  ],
);

export const businessDocumentLinks = pgTable(
  "business_document_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull().references(() => businessDocuments.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").$type<BusinessDocumentTargetKind>().notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    eventFamilyId: uuid("event_family_id").references(() => eventFamilies.id, { onDelete: "set null" }),
    confirmationMode: text("confirmation_mode").$type<"manual" | "automatic" | "migrated">().notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().default(sql`'[]'::jsonb`).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("business_document_links_profile_unique").on(table.documentId, table.organizationId).where(sql`${table.organizationId} is not null`),
    uniqueIndex("business_document_links_booking_unique").on(table.documentId, table.bookingId).where(sql`${table.bookingId} is not null`),
    uniqueIndex("business_document_links_event_family_unique").on(table.documentId, table.eventFamilyId).where(sql`${table.eventFamilyId} is not null`),
    index("business_document_links_profile_idx").on(table.organizationId, table.createdAt),
    index("business_document_links_booking_idx").on(table.bookingId, table.createdAt),
    index("business_document_links_event_family_idx").on(table.eventFamilyId, table.createdAt),
    check("business_document_links_target_kind_valid", sql`${table.targetKind} in ('profile','booking','event_family')`),
    check("business_document_links_confirmation_valid", sql`${table.confirmationMode} in ('manual','automatic','migrated')`),
    check("business_document_links_confidence_valid", sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`),
    check("business_document_links_exact_target", sql`(
      (${table.organizationId} is not null)::int +
      (${table.bookingId} is not null)::int +
      (${table.eventFamilyId} is not null)::int
    ) = 1`),
    check("business_document_links_kind_matches_target", sql`(
      (${table.targetKind} = 'profile' and ${table.organizationId} is not null) or
      (${table.targetKind} = 'booking' and ${table.bookingId} is not null) or
      (${table.targetKind} = 'event_family' and ${table.eventFamilyId} is not null)
    )`),
  ],
);

export const businessDocumentSources = pgTable(
  "business_document_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull().references(() => businessDocuments.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").$type<BusinessDocumentSourceKind>().notNull(),
    sourceAccountKey: text("source_account_key").notNull(),
    externalId: text("external_id").notNull(),
    originalUrl: text("original_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    availability: text("availability").$type<"available" | "retry_required" | "unavailable">().default("available").notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("business_document_sources_identity_unique").on(table.sourceKind, table.sourceAccountKey, table.externalId),
    index("business_document_sources_document_idx").on(table.documentId, table.createdAt),
    check("business_document_sources_kind_valid", sql`${table.sourceKind} in ('manual','gmail','drive','business_source','google_profile_file','design_asset','design_output')`),
    check("business_document_sources_availability_valid", sql`${table.availability} in ('available','retry_required','unavailable')`),
    check("business_document_sources_retry_valid", sql`${table.retryCount} >= 0`),
  ],
);

export const businessDocumentCoiMetadata = pgTable(
  "business_document_coi_metadata",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull().references(() => businessDocuments.id, { onDelete: "cascade" }),
    officeAccountId: uuid("office_account_id").references(() => officeAccounts.id, { onDelete: "restrict" }),
    certificateName: text("certificate_name").notNull(),
    issueDate: date("issue_date"),
    expirationDate: date("expiration_date"),
    reviewState: text("review_state").$type<"reviewed" | "needs_review">().default("needs_review").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("business_document_coi_document_unique").on(table.documentId),
    index("business_document_coi_expiration_idx").on(table.expirationDate),
    check("business_document_coi_review_valid", sql`${table.reviewState} in ('reviewed','needs_review')`),
    check("business_document_coi_dates_valid", sql`${table.issueDate} is null or ${table.expirationDate} is null or ${table.issueDate} <= ${table.expirationDate}`),
  ],
);

export const businessDocumentReviewItems = pgTable(
  "business_document_review_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull().references(() => businessDocuments.id, { onDelete: "cascade" }),
    kind: text("kind").$type<BusinessDocumentReviewKind>().notNull(),
    state: text("state").$type<"pending" | "deferred" | "approved" | "rejected">().default("pending").notNull(),
    proposals: jsonb("proposals").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    reasonCodes: text("reason_codes").array().default(sql`ARRAY[]::text[]`).notNull(),
    deferredUntil: timestamp("deferred_until", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    lastErrorCode: text("last_error_code"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("business_document_review_state_created_idx").on(table.state, table.createdAt),
    index("business_document_review_document_idx").on(table.documentId),
    check("business_document_review_kind_valid", sql`${table.kind} in ('classification','relationship','metadata','source_failure')`),
    check("business_document_review_item_state_valid", sql`${table.state} in ('pending','deferred','approved','rejected')`),
    check("business_document_review_attempts_valid", sql`${table.attempts} >= 0`),
  ],
);

export const businessDocumentAuditEvents = pgTable(
  "business_document_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").references(() => businessDocuments.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("business_document_audit_document_created_idx").on(table.documentId, table.createdAt)],
);

export const businessDocumentImportRuns = pgTable(
  "business_document_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceKind: text("source_kind").$type<"legacy" | "drive" | "gmail">().notNull(),
    mode: text("mode").$type<"preview" | "pilot" | "full" | "incremental">().notNull(),
    status: text("status").$type<"queued" | "running" | "completed" | "completed_with_errors" | "failed">().default("queued").notNull(),
    scope: jsonb("scope").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    counts: jsonb("counts").$type<Record<string, number>>().default(sql`'{}'::jsonb`).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("business_document_import_runs_status_created_idx").on(table.status, table.createdAt),
    check("business_document_import_runs_source_valid", sql`${table.sourceKind} in ('legacy','drive','gmail')`),
    check("business_document_import_runs_mode_valid", sql`${table.mode} in ('preview','pilot','full','incremental')`),
    check("business_document_import_runs_status_valid", sql`${table.status} in ('queued','running','completed','completed_with_errors','failed')`),
  ],
);

export const businessDocumentImportItems = pgTable(
  "business_document_import_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull().references(() => businessDocumentImportRuns.id, { onDelete: "cascade" }),
    sourceExternalId: text("source_external_id").notNull(),
    status: text("status").$type<"discovered" | "imported" | "deduplicated" | "review" | "skipped" | "retry" | "failed">().default("discovered").notNull(),
    documentId: uuid("document_id").references(() => businessDocuments.id, { onDelete: "set null" }),
    sha256Hex: text("sha256_hex"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("business_document_import_items_identity_unique").on(table.runId, table.sourceExternalId),
    index("business_document_import_items_run_status_idx").on(table.runId, table.status),
    check("business_document_import_items_status_valid", sql`${table.status} in ('discovered','imported','deduplicated','review','skipped','retry','failed')`),
    check("business_document_import_items_sha256_valid", sql`${table.sha256Hex} is null or ${table.sha256Hex} ~ '^[0-9a-f]{64}$'`),
  ],
);
