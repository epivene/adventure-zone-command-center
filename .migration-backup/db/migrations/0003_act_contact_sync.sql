CREATE TABLE "act_contact_sync_states" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"base_snapshot" jsonb,
	"act_edited_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"local_dirty" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'unlinked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_contact_sync_states_state_valid" CHECK ("act_contact_sync_states"."state" in ('unlinked', 'synced', 'waiting', 'conflict'))
);
--> statement-breakpoint
CREATE TABLE "act_sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"local_contact_id" uuid,
	"act_record_id" text,
	"category" text NOT NULL,
	"decision" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"base_snapshot" jsonb,
	"local_snapshot" jsonb,
	"act_snapshot" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_sync_operations_status_valid" CHECK ("act_sync_operations"."status" in ('pending', 'approved', 'applying', 'completed', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "act_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'previewing' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_sync_runs_status_valid" CHECK ("act_sync_runs"."status" in ('previewing', 'previewed', 'applying', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_1" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_2" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "act_contact_sync_states" ADD CONSTRAINT "act_contact_sync_states_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_sync_operations" ADD CONSTRAINT "act_sync_operations_run_id_act_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."act_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_sync_operations" ADD CONSTRAINT "act_sync_operations_local_contact_id_contacts_id_fk" FOREIGN KEY ("local_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "act_sync_operations_run_row_unique" ON "act_sync_operations" USING btree ("run_id","row_key");