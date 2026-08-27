import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bookingOpportunityEmailState } from "@/db/schema";
import { OpportunityEmailRepository } from "./opportunity-email-repository";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPPORTUNITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTACT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-08-28T14:00:00.000Z");

let client: PGlite;
let repository: OpportunityEmailRepository;

function makeDraft(overrides: Partial<Parameters<OpportunityEmailRepository["create"]>[0]> = {}) {
  return {
    opportunityId: OPPORTUNITY_ID,
    organizationId: ORGANIZATION_ID,
    contactId: CONTACT_ID,
    eventYear: 2026,
    purpose: "new_outreach" as const,
    recipientEmail: "booking@example.com",
    recipientName: "Casey Organizer",
    subject: "Adventure Zone for Sample Fair",
    body: "Draft body",
    ...overrides,
  };
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key, name text not null);
    create table contacts (id uuid primary key, first_name text not null, last_name text not null);
    create table booking_opportunities (
      id uuid primary key,
      organization_id uuid not null references organizations(id),
      event_year integer not null
    );
    create table booking_opportunity_email_state (
      id uuid primary key default gen_random_uuid(),
      opportunity_id uuid not null references booking_opportunities(id) on delete cascade,
      organization_id uuid not null references organizations(id) on delete restrict,
      contact_id uuid references contacts(id) on delete set null,
      event_year integer not null,
      purpose text not null,
      state text not null default 'draft',
      gmail_draft_id text,
      gmail_message_id text,
      gmail_thread_id text,
      recipient_email text not null,
      recipient_name text,
      subject text not null,
      body text not null,
      scheduled_for timestamptz,
      sent_at timestamptz,
      last_failure_code text,
      last_failure_message text,
      send_request_key text,
      schedule_request_key text,
      dispatch_lease_owner text,
      dispatch_lease_expires_at timestamptz,
      dispatch_attempt_count integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index booking_opportunity_email_state_current_unique
      on booking_opportunity_email_state(opportunity_id)
      where state in ('draft','scheduled','failed');
    create unique index booking_opportunity_email_state_send_request_unique
      on booking_opportunity_email_state(send_request_key)
      where send_request_key is not null;
    create unique index booking_opportunity_email_state_schedule_request_unique
      on booking_opportunity_email_state(schedule_request_key)
      where schedule_request_key is not null;

    insert into organizations (id, name) values ('${ORGANIZATION_ID}', 'Permanent Event Profile');
    insert into contacts (id, first_name, last_name) values ('${CONTACT_ID}', 'Casey', 'Organizer');
    insert into booking_opportunities (id, organization_id, event_year)
    values ('${OPPORTUNITY_ID}', '${ORGANIZATION_ID}', 2026);
  `);

  const database = drizzle(client, { schema: { bookingOpportunityEmailState } });
  repository = new OpportunityEmailRepository(database as never);
});

afterEach(async () => {
  await client.close();
});

describe("OpportunityEmailRepository", () => {
  it("keeps one current draft per opportunity before send", async () => {
    const first = await repository.create(makeDraft());
    await expect(repository.create(makeDraft())).rejects.toThrow();
    expect((await repository.getCurrentForOpportunity(OPPORTUNITY_ID))?.id).toBe(first.id);
  });

  it("stores Gmail linkage, scheduling, and failure metadata", async () => {
    const created = await repository.create(makeDraft());
    const updated = await repository.update(created.id, {
      gmailDraftId: "gmail-draft-1",
      gmailThreadId: "thread-1",
      state: "failed",
      lastFailureCode: "gmail_503",
      lastFailureMessage: "Service unavailable",
    });

    expect(updated.gmailDraftId).toBe("gmail-draft-1");
    expect(updated.gmailThreadId).toBe("thread-1");
    expect(updated.state).toBe("failed");
    expect(updated.lastFailureCode).toBe("gmail_503");
  });

  it("finds idempotent send and schedule requests", async () => {
    const created = await repository.create(makeDraft());
    await repository.update(created.id, { sendRequestKey: "send-1", scheduleRequestKey: "schedule-1" });

    expect((await repository.findBySendRequestKey("send-1"))?.id).toBe(created.id);
    expect((await repository.findByScheduleRequestKey("schedule-1"))?.id).toBe(created.id);
  });

  it("claims only due scheduled work and prevents a second worker before lease expiry", async () => {
    const due = await repository.create(makeDraft({
      state: "scheduled",
      scheduledFor: new Date("2026-08-28T13:55:00.000Z"),
      scheduleRequestKey: "schedule-due",
    }));

    const first = await repository.claimOneDue({ workerId: "worker-1", now: NOW });
    const second = await repository.claimOneDue({ workerId: "worker-2", now: NOW });

    expect(first?.id).toBe(due.id);
    expect(second).toBeNull();
  });

  it("does not claim future scheduled work", async () => {
    await repository.create(makeDraft({
      state: "scheduled",
      scheduledFor: new Date("2026-08-28T14:05:00.000Z"),
      scheduleRequestKey: "schedule-future",
    }));

    await expect(repository.claimOneDue({ workerId: "worker-1", now: NOW })).resolves.toBeNull();
  });

  it("reclaims a scheduled draft after a stale dispatch lease expires", async () => {
    const due = await repository.create(makeDraft({
      state: "scheduled",
      scheduledFor: new Date("2026-08-28T13:55:00.000Z"),
      scheduleRequestKey: "schedule-stale",
    }));

    expect((await repository.claimOneDue({ workerId: "worker-1", now: NOW }))?.id).toBe(due.id);
    const afterLease = new Date(NOW.getTime() + 61_000);
    expect((await repository.claimOneDue({ workerId: "worker-2", now: afterLease }))?.id).toBe(due.id);
  });

  it("releases only the current worker's dispatch lease", async () => {
    const due = await repository.create(makeDraft({
      state: "scheduled",
      scheduledFor: new Date("2026-08-28T13:55:00.000Z"),
      scheduleRequestKey: "schedule-release",
    }));
    await repository.claimOneDue({ workerId: "worker-1", now: NOW });

    await repository.releaseLease(due.id, "worker-2", NOW);
    await expect(repository.claimOneDue({ workerId: "worker-3", now: NOW })).resolves.toBeNull();

    await repository.releaseLease(due.id, "worker-1", NOW);
    expect((await repository.claimOneDue({ workerId: "worker-3", now: NOW }))?.id).toBe(due.id);
  });
});
