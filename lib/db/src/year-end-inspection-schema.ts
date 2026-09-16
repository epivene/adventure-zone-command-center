import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { resources, travelLegs } from "./schema";

export const pieceLifecycleStatusValues = ["active", "stored_spare", "needs_repair", "replace", "retired"] as const;
export type PieceLifecycleStatus = (typeof pieceLifecycleStatusValues)[number];
export const yearEndInspectionStatusValues = ["draft", "in_progress", "completed"] as const;
export type YearEndInspectionStatus = (typeof yearEndInspectionStatusValues)[number];
export const yearEndInspectionEntryStateValues = ["not_started", "inspected", "not_present"] as const;
export type YearEndInspectionEntryState = (typeof yearEndInspectionEntryStateValues)[number];
export const pieceConditionValues = ["good", "needs_cleaning", "minor_repair", "major_repair", "replace", "retired"] as const;
export type PieceCondition = (typeof pieceConditionValues)[number];
export const inspectionPhotoUploadStatusValues = ["image_pending", "image_uploaded", "image_failed"] as const;
export type InspectionPhotoUploadStatus = (typeof inspectionPhotoUploadStatusValues)[number];
export type PhotoEllipse = { id: string; x: number; y: number; radiusX: number; radiusY: number };
export type PhotoAnnotationDocument = { version: 1; ellipses: PhotoEllipse[] };

export const equipmentPieces = pgTable("equipment_pieces", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  pieceType: text("piece_type").default("inflatable_component").notNull(),
  currentLegId: uuid("current_leg_id").references(() => travelLegs.id, { onDelete: "restrict" }),
  storageLocation: text("storage_location"),
  identityNotes: text("identity_notes"),
  lifecycleStatus: text("lifecycle_status").$type<PieceLifecycleStatus>().default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("equipment_pieces_active_code_unique").on(sql`lower(${table.code})`).where(sql`${table.archivedAt} is null`),
  index("equipment_pieces_leg_status_idx").on(table.currentLegId, table.lifecycleStatus),
  check("equipment_pieces_code_nonblank", sql`nullif(trim(${table.code}), '') is not null`),
  check("equipment_pieces_name_nonblank", sql`nullif(trim(${table.name}), '') is not null`),
]);

export const equipmentPieceAssignments = pgTable("equipment_piece_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  pieceId: uuid("piece_id").notNull().references(() => equipmentPieces.id, { onDelete: "restrict" }),
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  actorId: text("actor_id").notNull(),
  reason: text("reason"),
}, (table) => [
  uniqueIndex("equipment_piece_assignments_active_piece_unique").on(table.pieceId).where(sql`${table.removedAt} is null`),
  index("equipment_piece_assignments_resource_idx").on(table.resourceId, table.assignedAt),
]);

export const yearEndLegInspections = pgTable("year_end_leg_inspections", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientMutationId: uuid("client_mutation_id").notNull().unique(),
  legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
  inspectionYear: integer("inspection_year").notNull(),
  status: text("status").$type<YearEndInspectionStatus>().default("draft").notNull(),
  copiedFromInspectionId: uuid("copied_from_inspection_id").references(
    (): AnyPgColumn => yearEndLegInspections.id,
    { onDelete: "restrict" },
  ),
  managerIdentitySnapshot: text("manager_identity_snapshot"),
  overallNotes: text("overall_notes"),
  adminFollowUpNote: text("admin_follow_up_note"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("year_end_leg_inspections_active_leg_year_unique").on(table.legId, table.inspectionYear).where(sql`${table.archivedAt} is null`),
  index("year_end_leg_inspections_leg_updated_idx").on(table.legId, table.updatedAt),
  check("year_end_leg_inspections_year_range", sql`${table.inspectionYear} between 2000 and 2200`),
]);

export const yearEndInspectionEntries = pgTable("year_end_inspection_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientMutationId: uuid("client_mutation_id").notNull().unique(),
  inspectionId: uuid("inspection_id").notNull().references(() => yearEndLegInspections.id, { onDelete: "restrict" }),
  pieceId: uuid("piece_id").notNull().references(() => equipmentPieces.id, { onDelete: "restrict" }),
  pieceCodeSnapshot: text("piece_code_snapshot").notNull(),
  pieceNameSnapshot: text("piece_name_snapshot").notNull(),
  resourceIdSnapshot: uuid("resource_id_snapshot").references(() => resources.id, { onDelete: "set null" }),
  resourceNameSnapshot: text("resource_name_snapshot"),
  sortOrder: integer("sort_order").notNull(),
  entryState: text("entry_state").$type<YearEndInspectionEntryState>().default("not_started").notNull(),
  condition: text("condition").$type<PieceCondition>(),
  inspectionNotes: text("inspection_notes"),
  repairNeeded: boolean("repair_needed").default(false).notNull(),
  repairNotes: text("repair_notes"),
  retainForFutureUse: boolean("retain_for_future_use").default(true).notNull(),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }),
  inspectorIdentitySnapshot: text("inspector_identity_snapshot"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("year_end_inspection_entries_inspection_piece_unique").on(table.inspectionId, table.pieceId),
  index("year_end_inspection_entries_inspection_order_idx").on(table.inspectionId, table.sortOrder),
  check("year_end_inspection_entries_sort_nonnegative", sql`${table.sortOrder} >= 0`),
]);

export const yearEndInspectionPhotos = pgTable("year_end_inspection_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientMutationId: uuid("client_mutation_id").notNull().unique(),
  entryId: uuid("entry_id").notNull().references(() => yearEndInspectionEntries.id, { onDelete: "restrict" }),
  legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
  objectKey: text("object_key"),
  uploadStatus: text("upload_status").$type<InspectionPhotoUploadStatus>().default("image_pending").notNull(),
  mimeType: text("mime_type").notNull(),
  description: text("description"),
  annotations: jsonb("annotations").$type<PhotoAnnotationDocument>().default({ version: 1, ellipses: [] }).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("year_end_inspection_photos_entry_order_idx").on(table.entryId, table.sortOrder),
  check("year_end_inspection_photos_sort_nonnegative", sql`${table.sortOrder} >= 0`),
]);

export const yearEndInspectionMaintenanceItems = pgTable("year_end_inspection_maintenance_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryId: uuid("entry_id").notNull().unique().references(() => yearEndInspectionEntries.id, { onDelete: "restrict" }),
  state: text("state").$type<"open" | "resolved">().default("open").notNull(),
  followUpNotes: text("follow_up_notes"),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: text("created_by").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
}, (table) => [
  index("year_end_inspection_maintenance_state_idx").on(table.state, table.createdAt),
]);

export const yearEndInspectionAuditEvents = pgTable("year_end_inspection_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id").references(() => yearEndLegInspections.id, { onDelete: "restrict" }),
  pieceId: uuid("piece_id").references(() => equipmentPieces.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  actorId: text("actor_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("year_end_inspection_audit_inspection_idx").on(table.inspectionId, table.createdAt),
  index("year_end_inspection_audit_piece_idx").on(table.pieceId, table.createdAt),
  check("year_end_inspection_audit_target_required", sql`${table.inspectionId} is not null or ${table.pieceId} is not null`),
]);
