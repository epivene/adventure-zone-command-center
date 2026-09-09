import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { EarlyBirdPromoRepository } from "./early-bird-promo-repository";
import { EarlyBirdPromoService } from "./early-bird-promo-service";

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const CONTACT_ID = "20000000-0000-4000-8000-000000000001";
const OPPORTUNITY_ID = "30000000-0000-4000-8000-000000000001";
const OFFER_ID = "40000000-0000-4000-8000-000000000001";

async function setup(client: PGlite) {
  await client.exec(`
    create table organizations (id uuid primary key);
    create table contacts (
      id uuid primary key, first_name text not null default '',
      last_name text not null default '', email text
    );
    create table bookings (id uuid primary key);
    create table follow_ups (
      id uuid primary key default gen_random_uuid(), booking_id uuid,
      organization_id uuid, contact_id uuid, kind text not null,
      due_at timestamptz not null, completed_at timestamptz, outcome text,
      next_follow_up_id uuid, organization_location_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table office_accounts (id uuid primary key, display_name text not null);
    create table communication_templates (id uuid primary key);
    create table commercial_offer_rules (
      id uuid primary key, code text not null unique, name text not null,
      kind text not null, state text not null, audience text not null,
      source_document_id uuid, calculation_type text not null,
      amount_cents integer, amount_basis_points integer, calculation_scope text,
      stack_policy text not null, applies_to_package_codes text[] not null default '{}',
      new_customer_only boolean not null default false,
      repeat_customer_only boolean not null default false,
      requires_owner_confirmation boolean not null default false,
      deadline_mode text not null, deadline_days integer, fixed_deadline date,
      customer_summary text, internal_conditions text not null,
      source_conflict_note text, reviewed_by text, reviewed_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table booking_opportunities (
      id uuid primary key, organization_id uuid not null, event_year integer not null,
      booking_id uuid, contact_id uuid
    );
    create table office_email_drafts (
      id uuid primary key default gen_random_uuid(), office_account_id uuid,
      organization_id uuid not null, contact_id uuid not null,
      communication_template_id uuid, recipient_email text not null,
      subject text not null, body text not null, coordinator_note text,
      state text not null default 'draft', submitted_at timestamptz,
      owner_return_note text, sent_at timestamptz, sent_message_id text,
      last_send_error text, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into organizations values ('${ORG_ID}');
    insert into contacts (id, first_name, last_name, email)
      values ('${CONTACT_ID}', 'Casey', 'Organizer', 'casey@example.com');
    insert into booking_opportunities values ('${OPPORTUNITY_ID}', '${ORG_ID}', 2027, null, '${CONTACT_ID}');
    insert into commercial_offer_rules (
      id, code, name, kind, state, audience, calculation_type,
      amount_basis_points, stack_policy, deadline_mode, deadline_days,
      internal_conditions
    ) values (
      '${OFFER_ID}', 'early_bird_promo_2026_2027', 'Early Bird Promo — 10%',
      'discount', 'active', 'customer_safe', 'percent_basis_points', 1000,
      'manual', 'days_after_trigger', 30, 'Approved campaign.'
    );
  `);
  const migration = await readFile(path.resolve(
    process.cwd(),
    "../../lib/db/migrations/20260909_early_bird_promo.sql",
  ), "utf8");
  await client.exec(migration);
}

describe("Early Bird Promo lifecycle", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("keeps the first deadline, schedules from the first send, and secures on deposit", async () => {
    const client = new PGlite();
    clients.push(client);
    await setup(client);
    const db = drizzle(client, { schema });
    const repository = new EarlyBirdPromoRepository(db as never);
    const service = new EarlyBirdPromoService(repository);

    const first = await service.recordConfirmedSend({
      sourceKind: "opportunity_email",
      emailRecordId: "50000000-0000-4000-8000-000000000001",
      opportunityId: OPPORTUNITY_ID,
      organizationId: ORG_ID,
      bookingId: null,
      contactId: CONTACT_ID,
      officeAccountId: null,
      eventYear: 2027,
      templateCategory: "outreach",
      templateCode: "new_event_intro",
      sentAt: new Date("2026-09-10T15:00:00Z"),
      gmailMessageId: "gmail-first",
      gmailThreadId: "thread-first",
    });
    const repeated = await service.recordConfirmedSend({
      sourceKind: "opportunity_email",
      emailRecordId: "50000000-0000-4000-8000-000000000002",
      opportunityId: OPPORTUNITY_ID,
      organizationId: ORG_ID,
      bookingId: null,
      contactId: CONTACT_ID,
      officeAccountId: null,
      eventYear: 2027,
      templateCategory: "follow_up",
      templateCode: null,
      sentAt: new Date("2026-09-15T15:00:00Z"),
      gmailMessageId: "gmail-second",
      gmailThreadId: "thread-first",
    });

    expect(first?.deadlineDate).toBe("2026-10-10");
    expect(repeated?.id).toBe(first?.id);
    expect(repeated?.firstGmailMessageId).toBe("gmail-first");

    const interested = await service.confirmInterest({
      opportunityId: OPPORTUNITY_ID,
      confirmedAt: new Date("2026-09-20T15:00:00Z"),
      evidenceMessageId: null,
    });
    expect(interested?.reminderDueAt).toEqual(new Date("2026-09-25T05:00:00.000Z"));
    const repeatedInterest = await service.confirmInterest({
      opportunityId: OPPORTUNITY_ID,
      confirmedAt: new Date("2026-09-20T15:00:00Z"),
      evidenceMessageId: null,
    });
    expect(repeatedInterest?.id).toBe(interested?.id);

    const claimed = await repository.claimOneReminder({
      workerId: "worker-1",
      now: new Date("2026-09-25T05:00:00Z"),
    });
    expect(claimed?.id).toBe(first?.id);
    const artifacts = await repository.createReminderArtifacts({
      enrollmentId: claimed!.id,
      workerId: "worker-1",
      now: new Date("2026-09-25T05:00:00Z"),
    });
    expect(artifacts).toMatchObject({ draftId: expect.any(String), followUpId: expect.any(String) });
    expect((await client.query(`select state, body from office_email_drafts`)).rows)
      .toEqual([expect.objectContaining({
        state: "submitted",
        body: expect.stringContaining("Early Bird Promo ends October 10, 2026"),
      })]);
    expect((await client.query(`select kind from follow_ups`)).rows)
      .toEqual([{ kind: "early_bird_promo" }]);

    const secured = await service.recordDeposit({
      organizationId: ORG_ID,
      eventYear: 2027,
      receivedAt: new Date("2026-09-22T15:00:00Z"),
      source: "manual_profile",
    });
    expect(secured?.status).toBe("secured");
    expect(secured?.depositSource).toBe("manual_profile");
    expect((await client.query(`select state from office_email_drafts`)).rows)
      .toEqual([{ state: "cancelled" }]);
    expect((await client.query(`select completed_at is not null as completed from follow_ups`)).rows)
      .toEqual([{ completed: true }]);
  }, 20_000);

  it("does not enroll an ineligible or post-campaign send", async () => {
    const client = new PGlite();
    clients.push(client);
    await setup(client);
    const db = drizzle(client, { schema });
    const service = new EarlyBirdPromoService(new EarlyBirdPromoRepository(db as never));

    await expect(service.recordConfirmedSend({
      sourceKind: "office_email",
      emailRecordId: "60000000-0000-4000-8000-000000000001",
      opportunityId: null,
      organizationId: ORG_ID,
      bookingId: null,
      contactId: CONTACT_ID,
      officeAccountId: null,
      eventYear: 2027,
      templateCategory: "payment",
      templateCode: "deposit_received",
      sentAt: new Date("2026-10-01T15:00:00Z"),
      gmailMessageId: null,
      gmailThreadId: null,
    })).resolves.toBeNull();

    await expect(service.recordConfirmedSend({
      sourceKind: "office_email",
      emailRecordId: "60000000-0000-4000-8000-000000000002",
      opportunityId: null,
      organizationId: ORG_ID,
      bookingId: null,
      contactId: CONTACT_ID,
      officeAccountId: null,
      eventYear: 2027,
      templateCategory: "outreach",
      templateCode: "new_event_intro",
      sentAt: new Date("2027-04-01T05:00:00Z"),
      gmailMessageId: null,
      gmailThreadId: null,
    })).resolves.toBeNull();
  }, 20_000);
});
