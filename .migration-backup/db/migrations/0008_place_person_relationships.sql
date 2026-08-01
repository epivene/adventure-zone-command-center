CREATE TABLE "booking_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_contacts_booking_contact_unique" UNIQUE("booking_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "organization_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_contacts_organization_contact_unique" UNIQUE("organization_id","contact_id"),
	CONSTRAINT "organization_contacts_primary_is_active" CHECK (not "organization_contacts"."is_primary" or "organization_contacts"."active")
);
--> statement-breakpoint
ALTER TABLE "booking_contacts" ADD CONSTRAINT "booking_contacts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_contacts" ADD CONSTRAINT "booking_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_contacts" ADD CONSTRAINT "organization_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_contacts" ADD CONSTRAINT "organization_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_contacts_one_primary" ON "booking_contacts" USING btree ("booking_id") WHERE "booking_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "booking_contacts_contact_id_idx" ON "booking_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_contacts_one_active_primary" ON "organization_contacts" USING btree ("organization_id") WHERE "organization_contacts"."active" and "organization_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "organization_contacts_contact_id_idx" ON "organization_contacts" USING btree ("contact_id");--> statement-breakpoint
INSERT INTO "organization_contacts" (
  "organization_id",
  "contact_id",
  "is_primary",
  "active",
  "source"
)
SELECT
  "organization_id",
  "id",
  false,
  true,
  'legacy_backfill'
FROM "contacts"
WHERE "organization_id" IS NOT NULL
ON CONFLICT ("organization_id", "contact_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "organization_contacts" (
  "organization_id",
  "contact_id",
  "is_primary",
  "active",
  "source"
)
SELECT
  "organization_id",
  "primary_contact_id",
  false,
  true,
  'legacy_backfill'
FROM "bookings"
WHERE "organization_id" IS NOT NULL
  AND "primary_contact_id" IS NOT NULL
ON CONFLICT ("organization_id", "contact_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "booking_contacts" (
  "booking_id",
  "contact_id",
  "is_primary",
  "source"
)
SELECT
  "id",
  "primary_contact_id",
  true,
  'legacy_backfill'
FROM "bookings"
WHERE "primary_contact_id" IS NOT NULL
ON CONFLICT ("booking_id", "contact_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "contacts"
ADD CONSTRAINT "contacts_primary_organization_contact_fk"
FOREIGN KEY ("organization_id", "id")
REFERENCES "organization_contacts" ("organization_id", "contact_id");
--> statement-breakpoint
ALTER TABLE "bookings"
ADD CONSTRAINT "bookings_primary_booking_contact_fk"
FOREIGN KEY ("id", "primary_contact_id")
REFERENCES "booking_contacts" ("booking_id", "contact_id");
