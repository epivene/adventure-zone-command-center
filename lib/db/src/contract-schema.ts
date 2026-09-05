import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings, contacts, organizations } from "./schema";
import { designOutputs, designProjectVersions, designProjects } from "./design-studio-schema";
import { officeAccounts } from "./office-coordinator-schema";

export const contractProviderValues = ["adobe_sign"] as const;
export type ContractProvider = (typeof contractProviderValues)[number];

export const contractStateValues = [
  "draft",
  "ready",
  "pending_customer",
  "customer_signed",
  "countersign_pending",
  "completed",
  "declined",
  "cancelled",
  "expired",
  "failed",
  "replaced",
] as const;
export type ContractState = (typeof contractStateValues)[number];

export const contractAgreements = pgTable(
  "contract_agreements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").$type<ContractProvider>().notNull().default("adobe_sign"),
    projectId: uuid("project_id").notNull().references(() => designProjects.id, { onDelete: "restrict" }),
    outputId: uuid("output_id").notNull().references(() => designOutputs.id, { onDelete: "restrict" }),
    versionId: uuid("version_id").notNull().references(() => designProjectVersions.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    createdByAccountId: uuid("created_by_account_id").notNull().references(() => officeAccounts.id, { onDelete: "restrict" }),
    replacedAgreementId: uuid("replaced_agreement_id"),
    providerAgreementId: text("provider_agreement_id"),
    state: text("state").$type<ContractState>().notNull().default("draft"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    davidName: text("david_name").notNull(),
    davidEmail: text("david_email").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    customerSignedAt: timestamp("customer_signed_at", { withTimezone: true }),
    countersignPendingAt: timestamp("countersign_pending_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureDetails: text("failure_details"),
    signedPdfStorageKey: text("signed_pdf_storage_key"),
    auditTrailStorageKey: text("audit_trail_storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("contract_agreements_provider_valid", sql`${table.provider} in ('adobe_sign')`),
    check("contract_agreements_state_valid", sql`${table.state} in ('draft','ready','pending_customer','customer_signed','countersign_pending','completed','declined','cancelled','expired','failed','replaced')`),
    unique("contract_agreements_provider_id_unique").on(table.provider, table.providerAgreementId),
    index("contract_agreements_profile_updated_idx").on(table.organizationId, table.updatedAt),
    index("contract_agreements_project_updated_idx").on(table.projectId, table.updatedAt),
  ],
);

export const contractProviderEvents = pgTable(
  "contract_provider_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agreementId: uuid("agreement_id").notNull().references(() => contractAgreements.id, { onDelete: "restrict" }),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    providerStatus: text("provider_status"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("contract_provider_events_provider_event_unique").on(table.providerEventId),
    index("contract_provider_events_agreement_processed_idx").on(table.agreementId, table.processedAt),
  ],
);