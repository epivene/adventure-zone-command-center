CREATE TABLE "booking_package_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"package_template_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_resource_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"attribution_source" text DEFAULT 'inferred' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_resource_assignments_attribution_source_valid" CHECK ("booking_resource_assignments"."attribution_source" in ('inferred', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "booking_resource_package_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_resource_assignment_id" uuid NOT NULL,
	"package_template_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_special_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"description" text NOT NULL,
	"treatment" text NOT NULL,
	"approval_status" text DEFAULT 'needs_approval' NOT NULL,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_special_requests_description_nonblank" CHECK (nullif(trim("booking_special_requests"."description"), '') is not null),
	CONSTRAINT "booking_special_requests_treatment_valid" CHECK ("booking_special_requests"."treatment" in ('add_to_count', 'replace_included', 'note_only')),
	CONSTRAINT "booking_special_requests_approval_status_valid" CHECK ("booking_special_requests"."approval_status" in ('needs_approval', 'approved', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "package_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"base_attraction_count" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_templates_code_nonblank" CHECK (nullif(trim("package_templates"."code"), '') is not null),
	CONSTRAINT "package_templates_name_nonblank" CHECK (nullif(trim("package_templates"."name"), '') is not null),
	CONSTRAINT "package_templates_base_attraction_count_positive" CHECK ("package_templates"."base_attraction_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "resource_conflict_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"resource_id" uuid,
	"conflict_key" text NOT NULL,
	"reason" text NOT NULL,
	"acknowledged_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_conflict_overrides_conflict_key_nonblank" CHECK (nullif(trim("resource_conflict_overrides"."conflict_key"), '') is not null),
	CONSTRAINT "resource_conflict_overrides_reason_nonblank" CHECK (nullif(trim("resource_conflict_overrides"."reason"), '') is not null),
	CONSTRAINT "resource_conflict_overrides_acknowledged_by_nonblank" CHECK (nullif(trim("resource_conflict_overrides"."acknowledged_by"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "resource_package_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"package_template_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"counts_as_attraction" boolean DEFAULT false NOT NULL,
	"movable" boolean DEFAULT false NOT NULL,
	"normal_travel_leg_id" uuid,
	"setup_minutes" integer DEFAULT 0 NOT NULL,
	"teardown_minutes" integer DEFAULT 0 NOT NULL,
	"minimum_transfer_minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_code_nonblank" CHECK (nullif(trim("resources"."code"), '') is not null),
	CONSTRAINT "resources_name_nonblank" CHECK (nullif(trim("resources"."name"), '') is not null),
	CONSTRAINT "resources_category_nonblank" CHECK (nullif(trim("resources"."category"), '') is not null),
	CONSTRAINT "resources_status_valid" CHECK ("resources"."status" in ('available', 'unavailable', 'maintenance', 'archived')),
	CONSTRAINT "resources_setup_minutes_nonnegative" CHECK ("resources"."setup_minutes" >= 0),
	CONSTRAINT "resources_teardown_minutes_nonnegative" CHECK ("resources"."teardown_minutes" >= 0),
	CONSTRAINT "resources_minimum_transfer_minutes_nonnegative" CHECK ("resources"."minimum_transfer_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "physical_attraction_total" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "attraction_total_approval_reason" text;--> statement-breakpoint
ALTER TABLE "booking_package_selections" ADD CONSTRAINT "booking_package_selections_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_package_selections" ADD CONSTRAINT "booking_package_selections_package_template_id_package_templates_id_fk" FOREIGN KEY ("package_template_id") REFERENCES "public"."package_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_resource_assignments" ADD CONSTRAINT "booking_resource_assignments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_resource_assignments" ADD CONSTRAINT "booking_resource_assignments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_resource_package_attributions" ADD CONSTRAINT "booking_resource_package_attributions_booking_resource_assignment_id_booking_resource_assignments_id_fk" FOREIGN KEY ("booking_resource_assignment_id") REFERENCES "public"."booking_resource_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_resource_package_attributions" ADD CONSTRAINT "booking_resource_package_attributions_package_template_id_package_templates_id_fk" FOREIGN KEY ("package_template_id") REFERENCES "public"."package_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_special_requests" ADD CONSTRAINT "booking_special_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_conflict_overrides" ADD CONSTRAINT "resource_conflict_overrides_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_conflict_overrides" ADD CONSTRAINT "resource_conflict_overrides_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_package_tags" ADD CONSTRAINT "resource_package_tags_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_package_tags" ADD CONSTRAINT "resource_package_tags_package_template_id_package_templates_id_fk" FOREIGN KEY ("package_template_id") REFERENCES "public"."package_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_normal_travel_leg_id_travel_legs_id_fk" FOREIGN KEY ("normal_travel_leg_id") REFERENCES "public"."travel_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_package_selections_booking_package_unique" ON "booking_package_selections" USING btree ("booking_id","package_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_resource_assignments_booking_resource_unique" ON "booking_resource_assignments" USING btree ("booking_id","resource_id");--> statement-breakpoint
CREATE INDEX "booking_resource_assignments_resource_id_idx" ON "booking_resource_assignments" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_resource_package_attributions_assignment_package_unique" ON "booking_resource_package_attributions" USING btree ("booking_resource_assignment_id","package_template_id");--> statement-breakpoint
CREATE INDEX "booking_special_requests_booking_status_treatment_idx" ON "booking_special_requests" USING btree ("booking_id","approval_status","treatment");--> statement-breakpoint
CREATE UNIQUE INDEX "package_templates_code_unique" ON "package_templates" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_conflict_overrides_booking_conflict_unique" ON "resource_conflict_overrides" USING btree ("booking_id","conflict_key");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_package_tags_resource_package_unique" ON "resource_package_tags" USING btree ("resource_id","package_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_code_unique" ON "resources" USING btree ("code");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_physical_attraction_total_nonnegative" CHECK ("bookings"."physical_attraction_total" is null or "bookings"."physical_attraction_total" >= 0);
