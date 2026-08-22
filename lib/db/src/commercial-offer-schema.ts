import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { businessSourceDocuments } from "./business-source-schema";

export const commercialOfferKindValues = [
  "discount",
  "payment_option",
  "fee",
] as const;
export type CommercialOfferKind = (typeof commercialOfferKindValues)[number];

export const commercialOfferStateValues = [
  "proposed",
  "active",
  "archived",
] as const;
export type CommercialOfferState = (typeof commercialOfferStateValues)[number];

export const commercialOfferCalculationValues = [
  "fixed_cents",
  "percent_basis_points",
  "revenue_share",
  "variable",
] as const;
export type CommercialOfferCalculation =
  (typeof commercialOfferCalculationValues)[number];

export const commercialOfferStackPolicyValues = [
  "stackable",
  "exclusive",
  "manual",
] as const;
export type CommercialOfferStackPolicy =
  (typeof commercialOfferStackPolicyValues)[number];

export const commercialOfferDeadlineModeValues = [
  "none",
  "manual",
  "days_after_trigger",
  "fixed_date",
] as const;
export type CommercialOfferDeadlineMode =
  (typeof commercialOfferDeadlineModeValues)[number];

export const commercialOfferAudienceValues = [
  "owner_only",
  "customer_safe",
] as const;
export type CommercialOfferAudience =
  (typeof commercialOfferAudienceValues)[number];

export const commercialOfferRules = pgTable(
  "commercial_offer_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<CommercialOfferKind>().notNull(),
    state: text("state").$type<CommercialOfferState>().default("proposed").notNull(),
    audience: text("audience").$type<CommercialOfferAudience>().default("owner_only").notNull(),
    sourceDocumentId: uuid("source_document_id").references(
      () => businessSourceDocuments.id,
      { onDelete: "set null" },
    ),
    calculationType: text("calculation_type")
      .$type<CommercialOfferCalculation>()
      .notNull(),
    amountCents: integer("amount_cents"),
    amountBasisPoints: integer("amount_basis_points"),
    calculationScope: text("calculation_scope"),
    stackPolicy: text("stack_policy")
      .$type<CommercialOfferStackPolicy>()
      .default("manual")
      .notNull(),
    appliesToPackageCodes: text("applies_to_package_codes")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    newCustomerOnly: boolean("new_customer_only").default(false).notNull(),
    repeatCustomerOnly: boolean("repeat_customer_only").default(false).notNull(),
    requiresOwnerConfirmation: boolean("requires_owner_confirmation")
      .default(true)
      .notNull(),
    deadlineMode: text("deadline_mode")
      .$type<CommercialOfferDeadlineMode>()
      .default("none")
      .notNull(),
    deadlineDays: integer("deadline_days"),
    fixedDeadline: date("fixed_deadline"),
    customerSummary: text("customer_summary"),
    internalConditions: text("internal_conditions").notNull(),
    sourceConflictNote: text("source_conflict_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("commercial_offer_rules_code_unique").on(table.code),
    index("commercial_offer_rules_state_audience_kind_idx").on(
      table.state,
      table.audience,
      table.kind,
    ),
    index("commercial_offer_rules_source_document_idx").on(table.sourceDocumentId),
    check(
      "commercial_offer_rules_kind_valid",
      sql`${table.kind} in ('discount','payment_option','fee')`,
    ),
    check(
      "commercial_offer_rules_state_valid",
      sql`${table.state} in ('proposed','active','archived')`,
    ),
    check(
      "commercial_offer_rules_audience_valid",
      sql`${table.audience} in ('owner_only','customer_safe')`,
    ),
    check(
      "commercial_offer_rules_calculation_valid",
      sql`${table.calculationType} in ('fixed_cents','percent_basis_points','revenue_share','variable')`,
    ),
    check(
      "commercial_offer_rules_stack_policy_valid",
      sql`${table.stackPolicy} in ('stackable','exclusive','manual')`,
    ),
    check(
      "commercial_offer_rules_deadline_mode_valid",
      sql`${table.deadlineMode} in ('none','manual','days_after_trigger','fixed_date')`,
    ),
    check(
      "commercial_offer_rules_amount_cents_nonnegative",
      sql`${table.amountCents} is null or ${table.amountCents} >= 0`,
    ),
    check(
      "commercial_offer_rules_basis_points_range",
      sql`${table.amountBasisPoints} is null or (${table.amountBasisPoints} >= 0 and ${table.amountBasisPoints} <= 10000)`,
    ),
    check(
      "commercial_offer_rules_deadline_days_nonnegative",
      sql`${table.deadlineDays} is null or ${table.deadlineDays} >= 0`,
    ),
    check(
      "commercial_offer_rules_customer_flags_not_contradictory",
      sql`not (${table.newCustomerOnly} and ${table.repeatCustomerOnly})`,
    ),
    check(
      "commercial_offer_rules_internal_conditions_nonblank",
      sql`nullif(trim(${table.internalConditions}), '') is not null`,
    ),
  ],
);
