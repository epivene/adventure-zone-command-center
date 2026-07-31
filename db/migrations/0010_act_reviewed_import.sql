CREATE TABLE "act_migration_apply_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"manifest_digest" text NOT NULL,
	"summary" jsonb,
	"last_error_code" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_migration_apply_batches_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "act_migration_apply_batches_status_valid" CHECK ("act_migration_apply_batches"."status" in ('pending', 'applying', 'partially_applied', 'applied', 'failed')),
	CONSTRAINT "act_migration_apply_batches_requested_by_nonblank" CHECK (btrim("act_migration_apply_batches"."requested_by") <> ''),
	CONSTRAINT "act_migration_apply_batches_manifest_digest_nonblank" CHECK (btrim("act_migration_apply_batches"."manifest_digest") <> '')
);
--> statement-breakpoint
CREATE TABLE "act_migration_apply_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"proposal_key" text NOT NULL,
	"target_entity_type" text NOT NULL,
	"dependency_proposal_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"applied_entity_id" uuid,
	"error_code" text,
	"retryable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "act_migration_apply_operations_run_proposal_unique" UNIQUE("run_id","proposal_key"),
	CONSTRAINT "act_migration_apply_operations_target_entity_type_valid" CHECK ("act_migration_apply_operations"."target_entity_type" in ('organization', 'contact', 'organization_contact', 'booking', 'booking_contact', 'calling_list', 'calling_list_member')),
	CONSTRAINT "act_migration_apply_operations_dependency_proposal_keys_array" CHECK (jsonb_typeof("act_migration_apply_operations"."dependency_proposal_keys") = 'array'),
	CONSTRAINT "act_migration_apply_operations_status_valid" CHECK ("act_migration_apply_operations"."status" in ('pending', 'leased', 'blocked', 'applied', 'ignored', 'failed')),
	CONSTRAINT "act_migration_apply_operations_attempt_count_nonnegative" CHECK ("act_migration_apply_operations"."attempt_count" >= 0),
	CONSTRAINT "act_migration_apply_operations_lease_valid" CHECK (("act_migration_apply_operations"."status" = 'leased') = ("act_migration_apply_operations"."lease_owner" is not null and "act_migration_apply_operations"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "calling_list_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calling_list_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" text DEFAULT 'act_migration' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calling_list_memberships_list_contact_unique" UNIQUE("calling_list_id","contact_id"),
	CONSTRAINT "calling_list_memberships_source_valid" CHECK ("calling_list_memberships"."source" in ('act_migration', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "calling_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"filter_version" integer,
	"filter_definition" jsonb,
	"source_status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calling_lists_name_nonblank" CHECK (nullif(trim("calling_lists"."name"), '') is not null),
	CONSTRAINT "calling_lists_kind_valid" CHECK ("calling_lists"."kind" in ('static', 'dynamic')),
	CONSTRAINT "calling_lists_filter_definition_valid" CHECK (("calling_lists"."kind" = 'static' and "calling_lists"."filter_version" is null and "calling_lists"."filter_definition" is null) or ("calling_lists"."kind" = 'dynamic' and "calling_lists"."filter_version" = 1 and "calling_lists"."filter_definition" is not null and jsonb_typeof("calling_lists"."filter_definition") = 'object')),
	CONSTRAINT "calling_lists_source_status_valid" CHECK ("calling_lists"."source_status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "act_migration_proposals" DROP CONSTRAINT "act_migration_proposals_decision_valid";--> statement-breakpoint
ALTER TABLE "act_migration_records" DROP CONSTRAINT "act_migration_records_matched_entity_type_valid";--> statement-breakpoint
ALTER TABLE "act_migration_runs" DROP CONSTRAINT "act_migration_runs_status_valid";--> statement-breakpoint
ALTER TABLE "act_migration_apply_batches" ADD CONSTRAINT "act_migration_apply_batches_run_id_act_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."act_migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_migration_apply_operations" ADD CONSTRAINT "act_migration_apply_operations_batch_id_act_migration_apply_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."act_migration_apply_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_migration_apply_operations" ADD CONSTRAINT "act_migration_apply_operations_run_id_act_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."act_migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calling_list_memberships" ADD CONSTRAINT "calling_list_memberships_calling_list_id_calling_lists_id_fk" FOREIGN KEY ("calling_list_id") REFERENCES "public"."calling_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calling_list_memberships" ADD CONSTRAINT "calling_list_memberships_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "act_migration_apply_batches_run_id_idx" ON "act_migration_apply_batches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "act_migration_apply_operations_run_batch_idx" ON "act_migration_apply_operations" USING btree ("run_id","batch_id");--> statement-breakpoint
CREATE INDEX "act_migration_apply_operations_runnable_claim_idx" ON "act_migration_apply_operations" USING btree ("batch_id","status","lease_expires_at") WHERE "act_migration_apply_operations"."status" in ('pending', 'leased') and "act_migration_apply_operations"."retryable";--> statement-breakpoint
CREATE INDEX "calling_list_memberships_active_idx" ON "calling_list_memberships" USING btree ("calling_list_id","contact_id") WHERE "calling_list_memberships"."active";--> statement-breakpoint
CREATE INDEX "calling_lists_dynamic_kind_idx" ON "calling_lists" USING btree ("kind") WHERE "calling_lists"."kind" = 'dynamic';--> statement-breakpoint
ALTER TABLE "act_migration_proposals" ADD CONSTRAINT "act_migration_proposals_decision_valid" CHECK ("act_migration_proposals"."decision" is null or "act_migration_proposals"."decision" in ('approve_proposed', 'link_existing', 'keep_separate', 'confirm_static_group', 'ignore'));--> statement-breakpoint
ALTER TABLE "act_migration_records" ADD CONSTRAINT "act_migration_records_matched_entity_type_valid" CHECK ("act_migration_records"."matched_entity_type" is null or "act_migration_records"."matched_entity_type" in ('organization', 'contact', 'organization_contact', 'booking', 'booking_contact', 'calling_list', 'calling_list_member'));--> statement-breakpoint
ALTER TABLE "act_migration_runs" ADD CONSTRAINT "act_migration_runs_status_valid" CHECK ("act_migration_runs"."status" in ('snapshotting', 'snapshot_complete', 'matching', 'previewed', 'applying', 'partially_applied', 'applied', 'failed'));
