import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DrizzleWebsiteInquiryRepository } from "./website-inquiry-repository";
import { WebsiteInquiryReviewService } from "./website-inquiry-review-service";

let client: PGlite;
let repository: DrizzleWebsiteInquiryRepository;

beforeEach(async () => {
  client = new PGlite();
  repository = new DrizzleWebsiteInquiryRepository(drizzle(client) as never);
  await client.exec(`
    create table website_inquiries (
      id uuid primary key,
      submission_id uuid not null unique,
      reference_code text not null unique,
      status text not null default 'new',
      name text not null,
      email text not null,
      normalized_email text not null,
      event_name text not null,
      event_date date,
      event_location text,
      package_interest text,
      message text not null,
      page_url text not null,
      source_origin text not null,
      content_fingerprint text not null,
      reviewed_by_kind text,
      reviewed_by_id text,
      reviewed_by_name text,
      reviewed_at timestamptz,
      converted_contact_id uuid,
      converted_organization_id uuid,
      converted_booking_id uuid,
      converted_at timestamptz,
      alert_state text not null default 'pending',
      alert_attempt_count integer not null default 0,
      alert_next_attempt_at timestamptz not null default now(),
      alert_last_attempt_at timestamptz,
      alert_failure_reason text,
      alert_delivered_recipients jsonb not null default '[]'::jsonb,
      alert_lease_owner text,
      alert_lease_expires_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table audit_entries (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id uuid not null,
      action text not null,
      before jsonb,
      after jsonb,
      reverses_entry_id uuid,
      created_at timestamptz not null default now()
    );
    insert into website_inquiries (
      id, submission_id, reference_code, name, email, normalized_email,
      event_name, message, page_url, source_origin, content_fingerprint,
      alert_next_attempt_at, created_at
    ) values (
      '20000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      'AZI-2026-AAAAAAAA',
      'Desie Example',
      'desie@example.com',
      'desie@example.com',
      'Summer Festival',
      'Please send availability.',
      'https://the-adventure-zone.com/#contact',
      'https://the-adventure-zone.com',
      'fingerprint',
      '2026-09-03T16:00:00.000Z',
      '2026-09-03T16:00:00.000Z'
    );
  `);
});

afterEach(async () => {
  await client.close();
});

describe("DrizzleWebsiteInquiryRepository alert leases", () => {
  it("keeps a second worker from claiming an active lease and reclaims it after expiry", async () => {
    const claimedAt = new Date("2026-09-03T16:00:00.000Z");

    await expect(
      repository.claimNextAlert({
        workerId: "worker-a",
        now: claimedAt,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toMatchObject({
      alertAttemptCount: 1,
      alertLeaseOwner: "worker-a",
    });
    await expect(
      repository.claimNextAlert({
        workerId: "worker-b",
        now: new Date("2026-09-03T16:04:59.999Z"),
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.claimNextAlert({
        workerId: "worker-b",
        now: new Date("2026-09-03T16:05:00.001Z"),
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toMatchObject({
      alertAttemptCount: 2,
      alertLeaseOwner: "worker-b",
    });
  });

  it("persists each delivered recipient once and clears the lease on completion", async () => {
    const claimedAt = new Date("2026-09-03T16:00:00.000Z");
    await repository.claimNextAlert({
      workerId: "worker-a",
      now: claimedAt,
      leaseMs: 5 * 60_000,
    });
    await repository.recordRecipientDelivered({
      inquiryId: "20000000-0000-4000-8000-000000000002",
      leaseOwner: "worker-a",
      recipient: "owner@example.com",
      now: claimedAt,
    });
    await repository.recordRecipientDelivered({
      inquiryId: "20000000-0000-4000-8000-000000000002",
      leaseOwner: "worker-a",
      recipient: "OWNER@example.com",
      now: claimedAt,
    });
    await repository.completeAlert({
      inquiryId: "20000000-0000-4000-8000-000000000002",
      leaseOwner: "worker-a",
      now: claimedAt,
    });

    expect(
      (
        await client.query(`
          select alert_state, alert_delivered_recipients, alert_lease_owner
          from website_inquiries
        `)
      ).rows,
    ).toEqual([
      {
        alert_state: "sent",
        alert_delivered_recipients: ["owner@example.com"],
        alert_lease_owner: null,
      },
    ]);
  });
});

describe("DrizzleWebsiteInquiryRepository review inbox", () => {
  it("lists a filtered page newest first and continues with a stable cursor", async () => {
    await client.exec(`
      insert into website_inquiries (
        id, submission_id, reference_code, status, name, email,
        normalized_email, event_name, message, page_url, source_origin,
        content_fingerprint, created_at
      ) values
      (
        '20000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003',
        'AZI-2026-BBBBBBBB', 'new', 'Newest', 'newest@example.com',
        'newest@example.com', 'Newest event', 'Message',
        'https://the-adventure-zone.com', 'https://the-adventure-zone.com',
        'fingerprint-2', '2026-09-03T17:00:00.000Z'
      ),
      (
        '20000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000004',
        'AZI-2026-CCCCCCCC', 'reviewing', 'Reviewing', 'review@example.com',
        'review@example.com', 'Reviewing event', 'Message',
        'https://the-adventure-zone.com', 'https://the-adventure-zone.com',
        'fingerprint-3', '2026-09-03T18:00:00.000Z'
      );
    `);

    const first = await repository.list({ status: "new", before: null, limit: 1 });
    expect(first.items.map(({ name }) => name)).toEqual(["Newest"]);
    expect(first.nextCursor).toBe(
      "2026-09-03T17:00:00.000Z,20000000-0000-4000-8000-000000000003",
    );
    const second = await repository.list({
      status: "new",
      before: {
        createdAt: new Date("2026-09-03T17:00:00.000Z"),
        id: "20000000-0000-4000-8000-000000000003",
      },
      limit: 1,
    });
    expect(second.items.map(({ name }) => name)).toEqual(["Desie Example"]);
    expect(second.nextCursor).toBeNull();
    await expect(repository.countNew()).resolves.toBe(2);
  });

  it("locks, changes status, and writes the actor-bearing audit in one transaction", async () => {
    const service = new WebsiteInquiryReviewService({
      repository,
      now: () => new Date("2026-09-03T18:00:00.000Z"),
    });

    await expect(
      service.changeStatus({
        inquiryId: "20000000-0000-4000-8000-000000000002",
        action: "begin_review",
        actor: { kind: "office", id: "amy-id", name: "Amy" },
      }),
    ).resolves.toMatchObject({
      status: "reviewing",
      reviewedByKind: "office",
      reviewedById: "amy-id",
      reviewedByName: "Amy",
    });

    const detail = await repository.getDetail(
      "20000000-0000-4000-8000-000000000002",
    );
    expect(detail?.auditHistory).toHaveLength(1);
    expect(detail?.auditHistory[0]).toMatchObject({
      entityType: "website_inquiry",
      action: "begin_review",
      before: { status: "new" },
      after: {
        status: "reviewing",
        actor: { kind: "office", id: "amy-id", name: "Amy" },
      },
    });
  });
});
