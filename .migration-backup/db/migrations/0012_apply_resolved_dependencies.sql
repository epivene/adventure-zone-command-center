ALTER TABLE "act_migration_apply_operations" ADD COLUMN "resolved_dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "act_migration_apply_operations" ADD CONSTRAINT "act_migration_apply_operations_resolved_dependencies_array" CHECK (jsonb_typeof("act_migration_apply_operations"."resolved_dependencies") = 'array');
