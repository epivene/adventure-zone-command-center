import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bookingOpportunities,
  bookings,
  contacts,
  googleWorkspaceCalendarScopes,
  googleWorkspaceConnections,
  packageTemplates,
} from "@/db/schema";
import { OpportunityEmailProfileRepository } from "./opportunity-email-profile-repository";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOOKING = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const OTHER_CONTACT = "44444444-4444-4444-8444-444444444444";
const CONNECTION = "55555555-5555-4555-8555-555555555555";

let client: PGlite;
let repository: OpportunityEmailProfileRepository;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null,
      city text,
      region text
    );
    create table contacts (
      id uuid primary key,
      organization_id uuid,
      first_name text not null,
      last_name text not null,
      email text,
      updated_at timestamptz not null default now()
    );
    create table bookings (
      id uuid primary key,
      organization_id uuid,
      name text not null,
      city text not null,
      region text not null,
      starts_at timestamptz,
      ends_at timestamptz
    );
    create table booking_opportunities (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      event_year integer not null,
      booking_id uuid,
      contact_id uuid,
      status text not null default 'ready_to_contact',
      priority text not null default 'normal',
      next_action_kind text,
      next_action_due_at timestamptz,
      hold_reason text,
      email_automation_protected boolean not null default false,
      territory_exception_approved boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table google_workspace_connections (
      id uuid primary key,
      account_email text not null,
      status text not null,
      encrypted_refresh_token jsonb not null,
      granted_scopes jsonb not null default '[]'::jsonb,
      connected_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table google_workspace_calendar_scopes (
      id uuid primary key default gen_random_uuid(),
      connection_id uuid not null,
      calendar_id text not null,
      summary text not null,
      primary_calendar boolean not null default false,
      selected boolean not null default true,
      discovered_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table package_templates (
      id uuid primary key default gen_random_uuid(),
      code text not null,
      name text not null,
      base_attraction_count integer not null,
      normal_capacity integer not null,
      temporary_unavailable_quantity integer not null,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    insert into organizations (id, name, city, region)
    values ('${ORG}', 'Sample Fair', 'Fallback City', 'CO');
    insert into bookings (id, organization_id, name, city, region, starts_at, ends_at)
    values ('${BOOKING}', '${ORG}', 'Sample Fair 2026', 'Booking City', 'WY', '2026-09-10T15:00:00Z', '2026-09-12T23:00:00Z');
    insert into contacts (id, organization_id, first_name, last_name, email, updated_at)
    values
      ('${CONTACT}', '${ORG}', 'Casey', 'Organizer', 'casey@example.com', '2026-08-27T12:00:00Z'),
      ('${OTHER_CONTACT}', '${ORG}', 'Old', 'Contact', 'old@example.com', '2026-08-28T12:00:00Z');
    insert into booking_opportunities (organization_id, event_year, booking_id, contact_id, updated_at)
    values ('${ORG}', 2026, '${BOOKING}', '${CONTACT}', '2026-08-27T18:00:00Z');
    insert into google_workspace_connections (id, account_email, status, encrypted_refresh_token)
    values ('${CONNECTION}', 'owner@example.com', 'connected', '{}'::jsonb);
    insert into google_workspace_calendar_scopes (connection_id, calendar_id, summary, primary_calendar, selected)
    values
      ('${CONNECTION}', 'primary@example.com', 'Primary', true, true),
      ('${CONNECTION}', 'hidden@example.com', 'Hidden', false, false);
    insert into package_templates (code, name, base_attraction_count, normal_capacity, temporary_unavailable_quantity, active)
    values
      ('adventure_zone', 'Adventure Zone', 10, 5, 1, true),
      ('old_package', 'Old Package', 1, 1, 0, false);
  `);

  const database = drizzle(client, {
    schema: {
      bookingOpportunities,
      bookings,
      contacts,
      googleWorkspaceConnections,
      googleWorkspaceCalendarScopes,
      packageTemplates,
    },
  });
  repository = new OpportunityEmailProfileRepository(database as never);
});

afterEach(async () => client.close());

describe("OpportunityEmailProfileRepository", () => {
  it("uses the linked current-year booking as the event profile evidence", async () => {
    await expect(repository.getProfile(ORG, 2026, BOOKING)).resolves.toEqual({
      eventName: "Sample Fair 2026",
      city: "Booking City",
      region: "WY",
      startsAt: new Date("2026-09-10T15:00:00.000Z"),
      endsAt: new Date("2026-09-12T23:00:00.000Z"),
    });
  });

  it("only exposes the contact explicitly attached to the current-year Opportunity", async () => {
    await expect(repository.listVerifiedRecipients(ORG, 2026)).resolves.toEqual([
      {
        contactId: CONTACT,
        email: "casey@example.com",
        name: "Casey Organizer",
        verifiedAt: new Date("2026-08-27T18:00:00.000Z"),
        source: "profile",
      },
    ]);
  });

  it("reads only selected calendars on the connected Google account", async () => {
    await expect(repository.selectedCalendars()).resolves.toEqual([
      { id: "primary@example.com", summary: "Primary", primary: true },
    ]);
  });

  it("reads only active package capacity", async () => {
    await expect(repository.activePackages()).resolves.toEqual([
      {
        code: "adventure_zone",
        name: "Adventure Zone",
        normalCapacity: 5,
        temporaryUnavailableQuantity: 1,
      },
    ]);
  });
});
