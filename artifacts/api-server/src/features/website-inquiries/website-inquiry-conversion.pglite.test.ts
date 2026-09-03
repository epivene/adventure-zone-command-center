import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DrizzleWebsiteInquiryConversionRepository,
  WebsiteInquiryConversionService,
} from "./website-inquiry-conversion";

let client: PGlite;
let service: WebsiteInquiryConversionService;
const inquiryId = "20000000-0000-4000-8000-000000000002";

beforeEach(async () => {
  client = new PGlite();
  service = new WebsiteInquiryConversionService({
    repository: new DrizzleWebsiteInquiryConversionRepository(
      drizzle(client) as never,
    ),
    now: () => new Date("2026-09-03T18:00:00.000Z"),
  });
  await client.exec(`
    create table website_inquiries (
      id uuid primary key, status text not null, reference_code text not null,
      event_name text not null, package_interest text, message text not null,
      reviewed_by_kind text, reviewed_by_id text, reviewed_by_name text,
      reviewed_at timestamptz, converted_contact_id uuid,
      converted_organization_id uuid, converted_booking_id uuid,
      converted_at timestamptz, updated_at timestamptz not null default now()
    );
    create table organizations (
      id uuid primary key default gen_random_uuid(), name text not null,
      act_record_id text, place_type text default 'other', act_industry text,
      phone text, normalized_phone text, address_1 text, address_2 text,
      city text, region text, postal_code text, website text,
      parent_organization_id uuid, consolidated_into_id uuid,
      consolidated_at timestamptz, last_resort boolean default false,
      last_resort_reason text, last_resort_changed_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table contacts (
      id uuid primary key default gen_random_uuid(), organization_id uuid,
      first_name text not null, last_name text not null, email text, phone text,
      normalized_phone text, quick_add_request_key uuid, job_title text,
      address_1 text, address_2 text, city text, region text, postal_code text,
      act_record_id text, organization_location_id uuid,
      created_at timestamptz not null, updated_at timestamptz not null
    );
    create table organization_contacts (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null,
      contact_id uuid not null, role text, is_primary boolean not null default false,
      active boolean not null default true, source text not null,
      created_at timestamptz not null, updated_at timestamptz not null,
      unique (organization_id, contact_id)
    );
    create table bookings (
      id uuid primary key default gen_random_uuid(), organization_id uuid,
      primary_contact_id uuid, name text not null, city text not null,
      venue_name text, address_1 text, region text not null, postal_code text,
      latitude double precision, longitude double precision,
      starts_at timestamptz, ends_at timestamptz, status text not null,
      probability text not null, travel_leg_id uuid, act_record_id text,
      organization_location_id uuid, notes text,
      physical_attraction_total integer, attraction_total_approval_reason text,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table booking_contacts (
      id uuid primary key default gen_random_uuid(), booking_id uuid not null,
      contact_id uuid not null, role text, is_primary boolean not null default false,
      source text not null, created_at timestamptz not null,
      updated_at timestamptz not null, unique (booking_id, contact_id)
    );
    create table follow_ups (
      id uuid primary key default gen_random_uuid(), booking_id uuid,
      organization_id uuid, contact_id uuid, kind text not null,
      due_at timestamptz not null, completed_at timestamptz,
      outcome text, next_follow_up_id uuid, organization_location_id uuid,
      created_at timestamptz not null, updated_at timestamptz not null
    );
    create table activities (
      id uuid primary key default gen_random_uuid(), organization_id uuid,
      contact_id uuid, booking_id uuid, kind text not null, subject text,
      status text, body text not null, occurred_at timestamptz,
      timeline_sort_at timestamptz not null,
      date_is_import_fallback boolean default false, ends_at timestamptz,
      act_record_id text, source_record_id uuid, source_version_id uuid,
      source_type text, organization_location_id uuid,
      created_at timestamptz not null, updated_at timestamptz not null,
      deleted_at timestamptz
    );
    create table audit_entries (
      id uuid primary key default gen_random_uuid(), entity_type text not null,
      entity_id uuid not null, action text not null, before jsonb, after jsonb,
      reverses_entry_id uuid, created_at timestamptz not null default now()
    );
    insert into website_inquiries
      (id, status, reference_code, event_name, package_interest, message)
    values
      ('${inquiryId}', 'new', 'AZI-2026-AAAAAAAA', 'Summer Festival',
       'Adventure Zone', 'Please send availability.');
  `);
});

afterEach(async () => {
  await client.close();
});

function convert() {
  return service.convert({
    inquiryId,
    actor: { kind: "owner", id: "owner", name: "Owner" },
    input: {
      contact: {
        mode: "create",
        firstName: "Desie",
        lastName: "Example",
        email: "desie@example.com",
      },
      organization: {
        mode: "create",
        name: "Summer Festival",
        city: "Denver",
        region: "CO",
      },
      booking: {
        name: "Summer Festival 2027",
        city: "Denver",
        region: "CO",
        packageInterest: "Adventure Zone",
      },
      nextAction: { kind: "call" },
    },
  });
}

describe("website inquiry conversion transaction", () => {
  it("returns one CRM result to two concurrent conversion attempts", async () => {
    const [first, second] = await Promise.all([convert(), convert()]);
    expect(second).toEqual({ ...first, alreadyConverted: true });
    for (const table of [
      "contacts",
      "organizations",
      "bookings",
      "follow_ups",
      "activities",
      "audit_entries",
    ]) {
      expect((await client.query(`select count(*)::int as count from ${table}`)).rows)
        .toEqual([{ count: 1 }]);
    }
  });

  it("rolls every CRM write back when a later conversion write fails", async () => {
    await client.exec("drop table activities");
    await expect(convert()).rejects.toThrow();
    for (const table of [
      "contacts",
      "organizations",
      "bookings",
      "follow_ups",
      "audit_entries",
    ]) {
      expect((await client.query(`select count(*)::int as count from ${table}`)).rows)
        .toEqual([{ count: 0 }]);
    }
    expect(
      (
        await client.query(
          "select status, converted_booking_id from website_inquiries",
        )
      ).rows,
    ).toEqual([{ status: "new", converted_booking_id: null }]);
  });
});
