ALTER TABLE "act_migration_proposals" ADD COLUMN "duplicate_group_key" text;--> statement-breakpoint
ALTER TABLE "act_migration_proposals" ADD COLUMN "duplicate_source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "act_migration_proposals" ADD CONSTRAINT "act_migration_proposals_duplicate_source_ids_array" CHECK (jsonb_typeof("act_migration_proposals"."duplicate_source_ids") = 'array');
