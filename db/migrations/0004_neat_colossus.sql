ALTER TABLE "act_sync_runs" DROP CONSTRAINT "act_sync_runs_status_valid";--> statement-breakpoint
ALTER TABLE "act_sync_operations" ADD COLUMN "retryable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "act_sync_runs" ADD CONSTRAINT "act_sync_runs_status_valid" CHECK ("act_sync_runs"."status" in ('previewing', 'previewed', 'applying', 'partial', 'completed', 'failed'));
