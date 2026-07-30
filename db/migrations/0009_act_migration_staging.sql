CREATE TABLE "act_migration_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stream_type" text NOT NULL,
	"partition_key" text NOT NULL,
	"parent_source_id" text,
	"next_skip" integer DEFAULT 0 NOT NULL,
	"page_size" integer NOT NULL,
	"query_mode" text DEFAULT 'projected' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"retry_after" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"records_staged" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_migration_checkpoints_stream_type_valid" CHECK ("act_migration_checkpoints"."stream_type" in ('company', 'contact', 'opportunity', 'group', 'company_contact', 'opportunity_company', 'opportunity_contact', 'group_contact')),
	CONSTRAINT "act_migration_checkpoints_query_mode_valid" CHECK ("act_migration_checkpoints"."query_mode" in ('projected', 'plain')),
	CONSTRAINT "act_migration_checkpoints_status_valid" CHECK ("act_migration_checkpoints"."status" in ('pending', 'fetching', 'complete', 'failed')),
	CONSTRAINT "act_migration_checkpoints_partition_key_nonblank" CHECK (btrim("act_migration_checkpoints"."partition_key") <> ''),
	CONSTRAINT "act_migration_checkpoints_next_skip_nonnegative" CHECK ("act_migration_checkpoints"."next_skip" >= 0),
	CONSTRAINT "act_migration_checkpoints_page_size_positive" CHECK ("act_migration_checkpoints"."page_size" > 0),
	CONSTRAINT "act_migration_checkpoints_attempt_count_nonnegative" CHECK ("act_migration_checkpoints"."attempt_count" >= 0),
	CONSTRAINT "act_migration_checkpoints_records_staged_nonnegative" CHECK ("act_migration_checkpoints"."records_staged" >= 0)
);
--> statement-breakpoint
CREATE TABLE "act_migration_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"proposal_key" text NOT NULL,
	"state" text NOT NULL,
	"target_entity_type" text NOT NULL,
	"source_record_keys" jsonb NOT NULL,
	"candidate_local_ids" jsonb NOT NULL,
	"proposed_local_id" uuid,
	"match_reason" text,
	"display_snapshot" jsonb NOT NULL,
	"decision" text,
	"decision_reason" text,
	"chosen_local_entity_id" uuid,
	"primary_source_id" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_migration_proposals_state_valid" CHECK ("act_migration_proposals"."state" in ('new', 'matched_unchanged', 'change', 'new_relationship', 'possible_duplicate', 'needs_review', 'ignored', 'error')),
	CONSTRAINT "act_migration_proposals_target_entity_type_valid" CHECK ("act_migration_proposals"."target_entity_type" in ('organization', 'contact', 'booking', 'organization_contact', 'booking_contact', 'calling_list', 'calling_list_member')),
	CONSTRAINT "act_migration_proposals_decision_valid" CHECK ("act_migration_proposals"."decision" is null or "act_migration_proposals"."decision" in ('approve_proposed', 'link_existing', 'keep_separate', 'ignore'))
);
--> statement-breakpoint
CREATE TABLE "act_migration_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stream_type" text NOT NULL,
	"source_key" text NOT NULL,
	"source_id" text,
	"target_source_id" text,
	"raw_snapshot" jsonb NOT NULL,
	"normalized_snapshot" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"proposed_action" text,
	"review_state" text DEFAULT 'not_required' NOT NULL,
	"proposal_key" text,
	"matched_entity_type" text,
	"matched_entity_id" uuid,
	"applied_entity_id" uuid,
	"error_code" text,
	"error_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_migration_records_stream_type_valid" CHECK ("act_migration_records"."stream_type" in ('company', 'contact', 'opportunity', 'group', 'company_contact', 'opportunity_company', 'opportunity_contact', 'group_contact')),
	CONSTRAINT "act_migration_records_source_key_nonblank" CHECK (btrim("act_migration_records"."source_key") <> ''),
	CONSTRAINT "act_migration_records_proposed_action_valid" CHECK ("act_migration_records"."proposed_action" is null or "act_migration_records"."proposed_action" in ('new', 'matched_unchanged', 'change', 'new_relationship', 'possible_duplicate', 'needs_review', 'ignored', 'error')),
	CONSTRAINT "act_migration_records_review_state_valid" CHECK ("act_migration_records"."review_state" in ('not_required', 'pending', 'decided', 'ignored')),
	CONSTRAINT "act_migration_records_matched_entity_type_valid" CHECK ("act_migration_records"."matched_entity_type" is null or "act_migration_records"."matched_entity_type" in ('organization', 'contact', 'booking', 'organization_contact', 'booking_contact', 'calling_list', 'calling_list_member'))
);
--> statement-breakpoint
CREATE TABLE "act_migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" uuid NOT NULL,
	"source_database_key" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'snapshotting' NOT NULL,
	"source_digest" text,
	"proposal_digest" text,
	"summary" jsonb,
	"last_error_code" text,
	"snapshot_completed_at" timestamp with time zone,
	"preview_completed_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_migration_runs_status_valid" CHECK ("act_migration_runs"."status" in ('snapshotting', 'snapshot_complete', 'matching', 'previewed', 'failed')),
	CONSTRAINT "act_migration_runs_source_database_key_nonblank" CHECK (btrim("act_migration_runs"."source_database_key") <> ''),
	CONSTRAINT "act_migration_runs_requested_by_nonblank" CHECK (btrim("act_migration_runs"."requested_by") <> '')
);
--> statement-breakpoint
ALTER TABLE "act_external_links" ADD COLUMN "source_entity_type" text;--> statement-breakpoint
ALTER TABLE "act_external_links" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "act_external_links" ADD COLUMN "sync_mode" text DEFAULT 'pull_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "act_external_links" ADD COLUMN "migration_run_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "place_type" text DEFAULT 'other';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "act_industry" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "normalized_phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_1" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_2" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
UPDATE "organizations"
SET "place_type" = 'other'
WHERE "place_type" IS NULL;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "place_type" SET NOT NULL;--> statement-breakpoint
UPDATE "act_external_links"
SET "source_entity_type" = CASE "entity_type"
  WHEN 'contact' THEN 'contact'
  WHEN 'organization' THEN 'company'
  WHEN 'booking' THEN 'opportunity'
  WHEN 'calling_list' THEN 'group'
  ELSE NULL
END;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "act_external_links"
    WHERE "source_entity_type" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'ACT_LINK_UNKNOWN_TYPE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "act_external_links"
    GROUP BY "source_entity_type", "act_record_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = 'ACT_LINK_DUPLICATE_SOURCE_OWNER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "contacts" AS local_record
    INNER JOIN "act_external_links" AS external_link
      ON external_link."source_entity_type" = 'contact'
      AND external_link."act_record_id" = local_record."act_record_id"
    WHERE local_record."act_record_id" IS NOT NULL
      AND (
        external_link."entity_type" <> 'contact'
        OR external_link."entity_id" <> local_record."id"
      )
    UNION ALL
    SELECT 1
    FROM "organizations" AS local_record
    INNER JOIN "act_external_links" AS external_link
      ON external_link."source_entity_type" = 'company'
      AND external_link."act_record_id" = local_record."act_record_id"
    WHERE local_record."act_record_id" IS NOT NULL
      AND (
        external_link."entity_type" <> 'organization'
        OR external_link."entity_id" <> local_record."id"
      )
    UNION ALL
    SELECT 1
    FROM "bookings" AS local_record
    INNER JOIN "act_external_links" AS external_link
      ON external_link."source_entity_type" = 'opportunity'
      AND external_link."act_record_id" = local_record."act_record_id"
    WHERE local_record."act_record_id" IS NOT NULL
      AND (
        external_link."entity_type" <> 'booking'
        OR external_link."entity_id" <> local_record."id"
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = 'ACT_LINK_OWNER_CONFLICT';
  END IF;
END
$$;--> statement-breakpoint
INSERT INTO "act_external_links" (
  "entity_type",
  "source_entity_type",
  "entity_id",
  "act_record_id",
  "is_primary",
  "sync_mode"
)
SELECT
  'organization',
  'company',
  local_record."id",
  local_record."act_record_id",
  false,
  'pull_only'
FROM "organizations" AS local_record
WHERE local_record."act_record_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "act_external_links" AS external_link
    WHERE external_link."source_entity_type" = 'company'
      AND external_link."act_record_id" = local_record."act_record_id"
  );--> statement-breakpoint
INSERT INTO "act_external_links" (
  "entity_type",
  "source_entity_type",
  "entity_id",
  "act_record_id",
  "is_primary",
  "sync_mode"
)
SELECT
  'contact',
  'contact',
  local_record."id",
  local_record."act_record_id",
  false,
  'pull_only'
FROM "contacts" AS local_record
WHERE local_record."act_record_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "act_external_links" AS external_link
    WHERE external_link."source_entity_type" = 'contact'
      AND external_link."act_record_id" = local_record."act_record_id"
  );--> statement-breakpoint
INSERT INTO "act_external_links" (
  "entity_type",
  "source_entity_type",
  "entity_id",
  "act_record_id",
  "is_primary",
  "sync_mode"
)
SELECT
  'booking',
  'opportunity',
  local_record."id",
  local_record."act_record_id",
  false,
  'pull_only'
FROM "bookings" AS local_record
WHERE local_record."act_record_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "act_external_links" AS external_link
    WHERE external_link."source_entity_type" = 'opportunity'
      AND external_link."act_record_id" = local_record."act_record_id"
  );--> statement-breakpoint
UPDATE "act_external_links"
SET "is_primary" = false,
    "sync_mode" = 'pull_only';--> statement-breakpoint
UPDATE "contacts" AS local_record
SET "act_record_id" = single_link."act_record_id"
FROM (
  SELECT
    "entity_id",
    min("act_record_id") AS "act_record_id"
  FROM "act_external_links"
  WHERE "entity_type" = 'contact'
    AND "source_entity_type" = 'contact'
  GROUP BY "entity_id"
  HAVING count(*) = 1
) AS single_link
WHERE local_record."id" = single_link."entity_id"
  AND local_record."act_record_id" IS NULL;--> statement-breakpoint
UPDATE "act_external_links" AS external_link
SET "is_primary" = true,
    "sync_mode" = 'two_way'
FROM "contacts" AS local_record
WHERE local_record."act_record_id" IS NOT NULL
  AND external_link."entity_type" = 'contact'
  AND external_link."source_entity_type" = 'contact'
  AND external_link."entity_id" = local_record."id"
  AND external_link."act_record_id" = local_record."act_record_id";--> statement-breakpoint
UPDATE "act_external_links" AS external_link
SET "is_primary" = true
FROM "organizations" AS local_record
WHERE external_link."entity_type" = 'organization'
  AND external_link."source_entity_type" = 'company'
  AND external_link."entity_id" = local_record."id"
  AND external_link."act_record_id" = local_record."act_record_id"
  AND local_record."act_record_id" IS NOT NULL;--> statement-breakpoint
UPDATE "act_external_links" AS external_link
SET "is_primary" = true
FROM "bookings" AS local_record
WHERE external_link."entity_type" = 'booking'
  AND external_link."source_entity_type" = 'opportunity'
  AND external_link."entity_id" = local_record."id"
  AND external_link."act_record_id" = local_record."act_record_id"
  AND local_record."act_record_id" IS NOT NULL;--> statement-breakpoint
UPDATE "act_external_links" AS external_link
SET "is_primary" = true
FROM (
  SELECT "entity_type", "source_entity_type", "entity_id"
  FROM "act_external_links"
  WHERE "entity_type" IN ('organization', 'booking')
  GROUP BY "entity_type", "source_entity_type", "entity_id"
  HAVING count(*) = 1
) AS single_link
WHERE external_link."entity_type" = single_link."entity_type"
  AND external_link."source_entity_type" = single_link."source_entity_type"
  AND external_link."entity_id" = single_link."entity_id";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "act_external_links"
    GROUP BY "source_entity_type", "act_record_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = 'ACT_LINK_DUPLICATE_SOURCE_OWNER';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "act_external_links"
  ALTER COLUMN "source_entity_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "act_migration_checkpoints" ADD CONSTRAINT "act_migration_checkpoints_run_id_act_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."act_migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_migration_proposals" ADD CONSTRAINT "act_migration_proposals_run_id_act_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."act_migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_migration_records" ADD CONSTRAINT "act_migration_records_run_id_act_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."act_migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "act_migration_checkpoints_run_stream_partition_unique" ON "act_migration_checkpoints" USING btree ("run_id","stream_type","partition_key");--> statement-breakpoint
CREATE UNIQUE INDEX "act_migration_proposals_run_key_unique" ON "act_migration_proposals" USING btree ("run_id","proposal_key");--> statement-breakpoint
CREATE UNIQUE INDEX "act_migration_records_run_stream_source_unique" ON "act_migration_records" USING btree ("run_id","stream_type","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "act_migration_runs_request_key_unique" ON "act_migration_runs" USING btree ("request_key");--> statement-breakpoint
ALTER TABLE "act_external_links" ADD CONSTRAINT "act_external_links_migration_run_id_act_migration_runs_id_fk" FOREIGN KEY ("migration_run_id") REFERENCES "public"."act_migration_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP INDEX "act_external_links_entity_external_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "act_external_links_source_external_id_unique" ON "act_external_links" USING btree ("source_entity_type","act_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "act_external_links_one_primary_per_local_source" ON "act_external_links" USING btree ("entity_type","entity_id","source_entity_type") WHERE "act_external_links"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "organizations_normalized_phone_idx" ON "organizations" USING btree ("normalized_phone");--> statement-breakpoint
ALTER TABLE "act_external_links" ADD CONSTRAINT "act_external_links_sync_mode_valid" CHECK ("act_external_links"."sync_mode" in ('two_way', 'pull_only'));--> statement-breakpoint
ALTER TABLE "act_external_links" ADD CONSTRAINT "act_external_links_type_pair_valid" CHECK (("act_external_links"."entity_type", "act_external_links"."source_entity_type") in (('organization', 'company'), ('contact', 'contact'), ('booking', 'opportunity'), ('calling_list', 'group')));--> statement-breakpoint
ALTER TABLE "act_external_links" ADD CONSTRAINT "act_external_links_contact_primary_sync_valid" CHECK (("act_external_links"."entity_type" = 'contact' and "act_external_links"."source_entity_type" = 'contact' and (("act_external_links"."is_primary" = true and "act_external_links"."sync_mode" = 'two_way') or ("act_external_links"."is_primary" = false and "act_external_links"."sync_mode" = 'pull_only'))) or ("act_external_links"."entity_type" <> 'contact' and "act_external_links"."sync_mode" = 'pull_only'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_place_type_valid" CHECK ("organizations"."place_type" in ('fair', 'city_government', 'festival_event', 'venue', 'school', 'tribe', 'association', 'company', 'other'));
