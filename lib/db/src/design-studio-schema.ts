import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bookings, contacts, organizations } from "./schema";
import { officeAccounts } from "./office-coordinator-schema";

export const designTypeValues = [
  "flyer",
  "social_post",
  "email",
  "brochure",
  "review_request",
  "contract",
  "blank",
] as const;
export type DesignType = (typeof designTypeValues)[number];

export const designProjectStatusValues = [
  "draft",
  "ready",
  "used",
  "sent",
  "archived",
] as const;
export type DesignProjectStatus = (typeof designProjectStatusValues)[number];

export const designSyncStateValues = ["synced", "pending", "failed"] as const;
export type DesignSyncState = (typeof designSyncStateValues)[number];

export const designTemplateVisibilityValues = [
  "private",
  "shared",
  "approved",
] as const;
export type DesignTemplateVisibility =
  (typeof designTemplateVisibilityValues)[number];

export const designAssetScopeValues = [
  "company",
  "package",
  "project",
  "event",
  "profile",
] as const;
export type DesignAssetScope = (typeof designAssetScopeValues)[number];

export const designOutputTypeValues = [
  "preview",
  "export",
  "gmail_draft",
  "review_request",
  "contract",
] as const;
export type DesignOutputType = (typeof designOutputTypeValues)[number];

export const designOutputStatusValues = [
  "pending",
  "ready",
  "failed",
  "void",
] as const;
export type DesignOutputStatus = (typeof designOutputStatusValues)[number];

export const designProjects = pgTable(
  "design_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    officeAccountId: uuid("office_account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: text("type").$type<DesignType>().notNull(),
    status: text("status")
      .$type<DesignProjectStatus>()
      .default("draft")
      .notNull(),
    syncState: text("sync_state")
      .$type<DesignSyncState>()
      .default("synced")
      .notNull(),
    content: text("content").default("").notNull(),
    notes: text("notes"),
    canvas: jsonb("canvas").$type<Record<string, unknown> | null>(),
    linkedOrganizationId: uuid("linked_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    linkedContactId: uuid("linked_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    linkedBookingId: uuid("linked_booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "design_projects_type_valid",
      sql`${table.type} in ('flyer','social_post','email','brochure','review_request','contract','blank')`,
    ),
    check(
      "design_projects_status_valid",
      sql`${table.status} in ('draft','ready','used','sent','archived')`,
    ),
    check(
      "design_projects_sync_state_valid",
      sql`${table.syncState} in ('synced','pending','failed')`,
    ),
    index("design_projects_account_updated_idx").on(
      table.officeAccountId,
      table.updatedAt,
    ),
    index("design_projects_status_idx").on(table.status, table.updatedAt),
  ],
);

export const designProjectVersions = pgTable(
  "design_project_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => designProjects.id, { onDelete: "restrict" }),
    versionNumber: text("version_number").notNull(),
    content: text("content").default("").notNull(),
    notes: text("notes"),
    canvas: jsonb("canvas").$type<Record<string, unknown> | null>(),
    status: text("status")
      .$type<DesignProjectStatus>()
      .default("draft")
      .notNull(),
    isImmutable: boolean("is_immutable").default(false).notNull(),
    createdByAccountId: uuid("created_by_account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (table) => [
    unique("design_project_versions_project_number_unique").on(
      table.projectId,
      table.versionNumber,
    ),
    check(
      "design_project_versions_status_valid",
      sql`${table.status} in ('draft','ready','used','sent','archived')`,
    ),
    index("design_project_versions_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const designTemplates = pgTable(
  "design_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdByAccountId: uuid("created_by_account_id").references(
      () => officeAccounts.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    type: text("type").$type<DesignType>().notNull(),
    description: text("description"),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    visibility: text("visibility")
      .$type<DesignTemplateVisibility>()
      .default("shared")
      .notNull(),
    isApproved: boolean("is_approved").default(false).notNull(),
    lockedContent: jsonb("locked_content").$type<Record<string, unknown> | null>(),
    content: text("content").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "design_templates_type_valid",
      sql`${table.type} in ('flyer','social_post','email','brochure','review_request','contract','blank')`,
    ),
    check(
      "design_templates_visibility_valid",
      sql`${table.visibility} in ('private','shared','approved')`,
    ),
    index("design_templates_type_visibility_idx").on(
      table.type,
      table.visibility,
    ),
  ],
);

export const designTemplateFavorites = pgTable(
  "design_template_favorites",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => designTemplates.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("design_template_favorites_account_template_unique").on(
      table.accountId,
      table.templateId,
    ),
  ],
);

export const designAssets = pgTable(
  "design_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    uploadedByAccountId: uuid("uploaded_by_account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    scope: text("scope").$type<DesignAssetScope>().notNull(),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sizeBytes: text("size_bytes"),
    altText: text("alt_text"),
    projectId: uuid("project_id").references(() => designProjects.id, {
      onDelete: "cascade",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    isApproved: boolean("is_approved").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "design_assets_scope_valid",
      sql`${table.scope} in ('company','package','project','event','profile')`,
    ),
    index("design_assets_scope_created_idx").on(table.scope, table.createdAt),
    index("design_assets_project_idx").on(table.projectId),
  ],
);

export const coiReviewStateValues = ["needs_review", "reviewed"] as const;
export type CoiReviewState = (typeof coiReviewStateValues)[number];

export const designCertificates = pgTable(
  "design_certificates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    officeAccountId: uuid("office_account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    assetId: uuid("asset_id").references(() => designAssets.id, { onDelete: "set null" }),
    issueDate: date("issue_date", { mode: "string" }),
    expirationDate: date("expiration_date", { mode: "string" }),
    reviewState: text("review_state")
      .$type<CoiReviewState>()
      .default("needs_review")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("design_certificates_review_state_valid", sql`${table.reviewState} in ('needs_review','reviewed')`),
    check(
      "design_certificates_dates_valid",
      sql`${table.issueDate} is null or ${table.expirationDate} is null or ${table.issueDate} <= ${table.expirationDate}`,
    ),
    uniqueIndex("design_certificates_asset_unique").on(table.assetId),
    index("design_certificates_account_expiration_idx").on(table.officeAccountId, table.expirationDate),
    index("design_certificates_booking_idx").on(table.bookingId),
    index("design_certificates_organization_idx").on(table.organizationId),
  ],
);

export const designSmartFields = pgTable(
  "design_smart_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => designProjects.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    valueSnapshot: text("value_snapshot"),
    state: text("state").default("current").notNull(),
    overriddenValue: text("overridden_value"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("design_smart_fields_project_key_unique").on(
      table.projectId,
      table.fieldKey,
    ),
    check(
      "design_smart_fields_state_valid",
      sql`${table.state} in ('current','overridden','outdated','unresolved')`,
    ),
    index("design_smart_fields_project_idx").on(table.projectId),
  ],
);

export const designOutputs = pgTable(
  "design_outputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => designProjects.id, { onDelete: "restrict" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => designProjectVersions.id, { onDelete: "restrict" }),
    createdByAccountId: uuid("created_by_account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "restrict" }),
    outputType: text("output_type").$type<DesignOutputType>().notNull(),
    status: text("status").$type<DesignOutputStatus>().default("pending").notNull(),
    storageKey: text("storage_key"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "design_outputs_type_valid",
      sql`${table.outputType} in ('preview','export','gmail_draft','review_request','contract')`,
    ),
    check(
      "design_outputs_status_valid",
      sql`${table.status} in ('pending','ready','failed','void')`,
    ),
    index("design_outputs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);