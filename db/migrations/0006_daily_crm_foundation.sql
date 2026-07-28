CREATE TYPE "public"."activity_kind" AS ENUM('call', 'note', 'follow_up', 'status_change', 'booking_update', 'contract_update', 'calendar', 'act_history', 'approved_suggestion');--> statement-breakpoint
CREATE TYPE "public"."call_disposition" AS ENUM('no_answer', 'left_voicemail', 'follow_up_needed', 'interested', 'proposal_sent', 'booked', 'declined', 'last_resort');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"contact_id" uuid,
	"booking_id" uuid,
	"kind" "activity_kind" NOT NULL,
	"body" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_parent_required" CHECK ("activities"."organization_id" is not null or "activities"."contact_id" is not null or "activities"."booking_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "activity_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"prior_body" text NOT NULL,
	"replacement_body" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"contact_id" uuid,
	"booking_id" uuid,
	"follow_up_id" uuid,
	"disposition" "call_disposition" NOT NULL,
	"note_activity_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "normalized_phone" text;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "last_resort" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "last_resort_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "last_resort_changed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "contacts"
SET "normalized_phone" = CASE
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[0-9]{10}$'
    THEN '+1' || regexp_replace("phone", '[^0-9]', '', 'g')
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
    THEN '+' || regexp_replace("phone", '[^0-9]', '', 'g')
  ELSE NULL
END
WHERE "phone" IS NOT NULL;--> statement-breakpoint
UPDATE "follow_ups"
SET
  "organization_id" = "bookings"."organization_id",
  "contact_id" = "bookings"."primary_contact_id"
FROM "bookings"
WHERE "follow_ups"."booking_id" = "bookings"."id";--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_revisions" ADD CONSTRAINT "activity_revisions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_follow_up_id_follow_ups_id_fk" FOREIGN KEY ("follow_up_id") REFERENCES "public"."follow_ups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_note_activity_id_activities_id_fk" FOREIGN KEY ("note_activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_normalized_phone_idx" ON "contacts" USING btree ("normalized_phone");--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_parent_required" CHECK ("follow_ups"."booking_id" is not null or "follow_ups"."organization_id" is not null or "follow_ups"."contact_id" is not null);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_last_resort_reason_required" CHECK (not "organizations"."last_resort" or nullif(trim("organizations"."last_resort_reason"), '') is not null);
