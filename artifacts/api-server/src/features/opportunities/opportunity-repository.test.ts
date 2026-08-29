import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bookingOpportunities,
  bookingOpportunityQueueOverrides,
} from "@/db/schema";
import { OpportunityRepository } from "./opportunity-repository";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOKING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTACT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let client: PGlite;
let repository: OpportunityRepository;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null
    );

    create table contacts (
      id uuid primary key,
      first_name text not null,
      last_name text not null
    );

    create table bookings (
      id uuid primary key,
      name text not null,
      city text not null,
      region text not null
    );

    create table booking_opportunities (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id) on delete restrict,
      event_year integer not null,
      booking_id uuid references bookings(id) on delete set null,
      contact_id uuid references contacts(id) on delete set null,
      status text not null default 'new_lead',
      priority text not null default 'normal',
      next_action_kind text,
      next_action_due_at timestamptz,
      hold_reason text,
      email_automation_protected boolean not null default false,
      territory_exception_approved boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint booking_opportunities_event_year_valid check (event_year between 2000 and 2200),
      constraint booking_opportunities_status_valid check (
        status in (
          'new_lead', 'researching', 'ready_to_contact', 'contacted',
          'follow_up', 'interested', 'booking_in_progress', 'booked',
          'not_pursuing', 'declined', 'no_response', 'territory_hold',
          'needs_review', 'cancelled'
        )
      ),
      constraint booking_opportunities_priority_valid check (
        priority in ('normal', 'high', 'urgent')
      ),
      unique (organization_id, event_year)
    );

    create table booking_opportunity_queue_overrides (
      opportunity_id uuid not null references booking_opportunities(id) on delete cascade,
      business_date date not null,
      pinned boolean not null default false,
      manual_order integer,
      snoozed_until timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (opportunity_id, business_date),
      constraint booking_opportunity_queue_overrides_manual_order_valid
        check (manual_order is null or manual_order >= 0)
    );

    insert into organizations (id, name)
    values ('${ORGANIZATION_ID}', 'Permanent Event Profile');

    insert into bookings (id, name, city, region)
    values ('${BOOKING_ID}', 'Annual Fair 2026', 'Sample City', 'CO');

    insert into contacts (id, first_name, last_name)
    values ('${CONTACT_ID}', 'Casey', 'Organizer');
  `);

  const database = drizzle(client, {
    schema: {
      bookingOpportunities,
      bookingOpportunityQueueOverrides,
    },
  });
  repository = new OpportunityRepository(database as never);
});

afterEach(async () => {
  await client.close();
});

describe("OpportunityRepository", () => {
  it("keeps separate yearly opportunities on one permanent profile", async () => {
    const first = await repository.create({
      organizationId: ORGANIZATION_ID,
      eventYear: 2026,
    });
    const second = await repository.create({
      organizationId: ORGANIZATION_ID,
      eventYear: 2027,
    });

    expect(first.id).not.toBe(second.id);
    expect(first.organizationId).toBe(second.organizationId);
    expect(first.eventYear).toBe(2026);
    expect(second.eventYear).toBe(2027);
  });

  it("rejects a duplicate organization/year opportunity", async () => {
    await repository.create({
      organizationId: ORGANIZATION_ID,
      eventYear: 2026,
    });

    await expect(
      repository.create({
        organizationId: ORGANIZATION_ID,
        eventYear: 2026,
      }),
    ).rejects.toThrow();
  });

  it("gets and updates the current event-year pursuit", async () => {
    const created = await repository.create({
      organizationId: ORGANIZATION_ID,
      eventYear: 2026,
      bookingId: BOOKING_ID,
      contactId: CONTACT_ID,
    });

    expect(
      await repository.getForOrganizationYear(ORGANIZATION_ID, 2026),
    ).toEqual(created);

    const updated = await repository.update(created.id, {
      status: "researching",
      priority: "high",
      nextActionKind: "research",
      nextActionDueAt: new Date("2026-08-27T15:00:00.000Z"),
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        status: "researching",
        priority: "high",
        nextActionKind: "research",
        nextActionDueAt: new Date("2026-08-27T15:00:00.000Z"),
      }),
    );
    expect(await repository.get(created.id)).toEqual(updated);
  });

  it("round-trips explicit email automation review controls", async () => {
    const created = await repository.create({
      organizationId: ORGANIZATION_ID,
      eventYear: 2026,
      emailAutomationProtected: true,
      territoryExceptionApproved: true,
    });

    expect(created).toEqual(expect.objectContaining({
      emailAutomationProtected: true,
      territoryExceptionApproved: true,
    }));

    const updated = await repository.update(created.id, {
      emailAutomationProtected: false,
      territoryExceptionApproved: false,
    });

    expect(updated).toEqual(expect.objectContaining({
      emailAutomationProtected: false,
      territoryExceptionApproved: false,
    }));
  });

  it("upserts one queue override per opportunity and business date", async () => {
    const opportunity = await repository.create({
      organizationId: ORGANIZATION_ID,
      eventYear: 2026,
    });

    await repository.upsertQueueOverride({
      opportunityId: opportunity.id,
      businessDate: "2026-08-26",
      pinned: true,
      manualOrder: 2,
      snoozedUntil: null,
    });

    const snoozedUntil = new Date("2026-08-26T20:00:00.000Z");
    const updated = await repository.upsertQueueOverride({
      opportunityId: opportunity.id,
      businessDate: "2026-08-26",
      pinned: false,
      manualOrder: null,
      snoozedUntil,
    });

    expect(updated).toEqual({
      opportunityId: opportunity.id,
      businessDate: "2026-08-26",
      pinned: false,
      manualOrder: null,
      snoozedUntil,
    });
    expect(
      await repository.getQueueOverride(opportunity.id, "2026-08-26"),
    ).toEqual(updated);
  });
});
