import { sql } from "drizzle-orm";
import { pgTable, uuid, text, date, timestamp, integer, boolean, jsonb, index, unique, check } from "drizzle-orm/pg-core";
import { organizations, bookings, followUps } from "./schema";
export const profileDeadlines=pgTable("profile_deadlines",{
  id:uuid("id").defaultRandom().primaryKey(),
  organizationId:uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"restrict"}),
  kind:text("kind").notNull(),label:text("label").notNull(),dueOn:date("due_on"),
  createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[index("profile_deadlines_profile").on(t.organizationId),check("profile_deadlines_kind_check",sql`${t.kind} in ('event','vendor','balance_due','next_action')`)]);
export const deadlinePreferences=pgTable("deadline_preferences",{
  sourceKey:text("source_key").primaryKey(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"restrict"}),
  reminderOffsets:integer("reminder_offsets").array(),completedForDate:date("completed_for_date"),
  updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[check("deadline_preferences_reminder_offsets_check",sql`${t.reminderOffsets} is null or (cardinality(${t.reminderOffsets}) <= 10 and 0 <= ALL(${t.reminderOffsets}) and 3650 >= ALL(${t.reminderOffsets}))`)]);
export const deadlineRules=pgTable("deadline_rules",{
  id:uuid("id").defaultRandom().primaryKey(),seedKey:text("seed_key").unique(),name:text("name").notNull(),
  enabled:boolean("enabled").notNull().default(true),trigger:jsonb("trigger").notNull(),actions:jsonb("actions").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),
});
export const deadlineStatusEvents=pgTable("deadline_status_events",{
  id:uuid("id").defaultRandom().primaryKey(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"restrict"}),
  bookingId:uuid("booking_id").notNull().references(()=>bookings.id,{onDelete:"restrict"}),
  oldStatus:text("old_status").notNull(),newStatus:text("new_status").notNull(),occurredAt:timestamp("occurred_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[index("deadline_status_events_time").on(t.occurredAt)]);
export const deadlineNotifications=pgTable("deadline_notifications",{
  id:uuid("id").defaultRandom().primaryKey(),ruleId:uuid("rule_id").notNull().references(()=>deadlineRules.id,{onDelete:"restrict"}),
  occurrenceKey:text("occurrence_key").notNull(),organizationId:uuid("organization_id").notNull().references(()=>organizations.id,{onDelete:"restrict"}),
  title:text("title").notNull(),dueOn:date("due_on"),active:boolean("active").notNull().default(true),
  dismissedAt:timestamp("dismissed_at",{withTimezone:true}),followUpId:uuid("follow_up_id").references(()=>followUps.id,{onDelete:"restrict"}),
  emailState:text("email_state").notNull().default("disabled"),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[unique("deadline_notifications_rule_id_occurrence_key_key").on(t.ruleId,t.occurrenceKey),index("deadline_notifications_active").on(t.active,t.createdAt)]);
export const deadlineEvaluationState=pgTable("deadline_evaluation_state",{
  id:integer("id").primaryKey(),lastEvaluatedAt:timestamp("last_evaluated_at",{withTimezone:true}),
},t=>[check("deadline_evaluation_state_id_check",sql`${t.id}=1`)]);
