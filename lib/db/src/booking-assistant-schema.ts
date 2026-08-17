import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { activities, bookings, contacts, organizations } from "./schema/index";

export const businessKnowledgeEntries = pgTable(
  "business_knowledge_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: text("scope").notNull(),
    scopeRecordId: uuid("scope_record_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sourceUrl: text("source_url"),
    sourceLabel: text("source_label"),
    active: boolean("active").default(true).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "business_knowledge_entries_scope_valid",
      sql`${table.scope} in ('global','package','resource','sales','operations')`,
    ),
    check(
      "business_knowledge_entries_title_nonblank",
      sql`nullif(trim(${table.title}), '') is not null`,
    ),
    check(
      "business_knowledge_entries_body_nonblank",
      sql`nullif(trim(${table.body}), '') is not null`,
    ),
    index("business_knowledge_entries_scope_active_idx").on(
      table.scope,
      table.scopeRecordId,
      table.active,
    ),
  ],
);

export const derivedCrmFacts = pgTable(
  "derived_crm_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    factKind: text("fact_kind").notNull(),
    value: jsonb("value").notNull(),
    summary: text("summary").notNull(),
    confidence: text("confidence").notNull(),
    sourceActivityId: uuid("source_activity_id").references(() => activities.id, {
      onDelete: "set null",
    }),
    sourceRecordId: uuid("source_record_id"),
    sourceVersionId: uuid("source_version_id"),
    extractionFingerprint: text("extraction_fingerprint").notNull(),
    status: text("status").default("proposed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "derived_crm_facts_parent_required",
      sql`${table.organizationId} is not null or ${table.contactId} is not null or ${table.bookingId} is not null`,
    ),
    check(
      "derived_crm_facts_confidence_valid",
      sql`${table.confidence} in ('high','medium','low')`,
    ),
    check(
      "derived_crm_facts_status_valid",
      sql`${table.status} in ('proposed','confirmed','dismissed')`,
    ),
    check(
      "derived_crm_facts_summary_nonblank",
      sql`nullif(trim(${table.summary}), '') is not null`,
    ),
    uniqueIndex("derived_crm_facts_extraction_fingerprint_unique").on(
      table.extractionFingerprint,
    ),
    index("derived_crm_facts_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("derived_crm_facts_contact_status_idx").on(table.contactId, table.status),
    index("derived_crm_facts_booking_status_idx").on(table.bookingId, table.status),
  ],
);

export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: text("actor_id").notNull(),
    contextKind: text("context_kind").notNull(),
    contextRecordId: uuid("context_record_id").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "assistant_conversations_context_kind_valid",
      sql`${table.contextKind} in ('organization','contact','event_family','booking','calendar_event','route','call_workspace')`,
    ),
    index("assistant_conversations_actor_context_idx").on(
      table.actorId,
      table.contextKind,
      table.contextRecordId,
      table.updatedAt,
    ),
  ],
);

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => assistantConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    body: text("body").notNull(),
    answerMode: text("answer_mode"),
    confidence: text("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("assistant_messages_role_valid", sql`${table.role} in ('user','assistant')`),
    check(
      "assistant_messages_answer_mode_valid",
      sql`${table.answerMode} is null or ${table.answerMode} in ('deterministic','cloud','offline_cached')`,
    ),
    check(
      "assistant_messages_confidence_valid",
      sql`${table.confidence} is null or ${table.confidence} in ('high','medium','low')`,
    ),
    check(
      "assistant_messages_body_nonblank",
      sql`nullif(trim(${table.body}), '') is not null`,
    ),
    index("assistant_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const assistantMessageSources = pgTable(
  "assistant_message_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => assistantMessages.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceRecordId: uuid("source_record_id").notNull(),
    label: text("label").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "assistant_message_sources_kind_nonblank",
      sql`nullif(trim(${table.sourceKind}), '') is not null`,
    ),
    check(
      "assistant_message_sources_label_nonblank",
      sql`nullif(trim(${table.label}), '') is not null`,
    ),
    index("assistant_message_sources_message_idx").on(table.messageId),
  ],
);
