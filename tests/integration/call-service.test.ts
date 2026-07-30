import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CallService,
  type CallRepository,
  type CallTransaction,
} from "@/features/calls/call-service";
import { DrizzleCallRepository } from "@/features/calls/call-repository";
import type {
  CallContext,
  CompleteCallInput,
} from "@/features/calls/call-types";
import * as crmSchema from "@/db/schema";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `call_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  contact: "22222222-2222-4222-8222-222222222222",
  booking: "33333333-3333-4333-8333-333333333333",
  followUp: "44444444-4444-4444-8444-444444444444",
};

function input(overrides: Partial<CompleteCallInput> = {}): CompleteCallInput {
  return {
    requestKey: "99999999-9999-4999-8999-999999999999",
    organizationId: ids.organization,
    contactId: ids.contact,
    bookingId: ids.booking,
    followUpId: ids.followUp,
    note: "Confirmed the August event.",
    disposition: "interested",
    resultingBookingStatus: null,
    startedAt: new Date("2026-08-01T15:00:00.000Z"),
    endedAt: new Date("2026-08-01T15:10:00.000Z"),
    nextAction: { kind: "send quote", dueAt: new Date("2026-08-02T15:00:00.000Z") },
    lastResortReason: null,
    lastResortConfirmed: false,
    approvedContactUpdates: { phone: "555-0123" },
    approvedBookingUpdates: { notes: "Confirmed on call" },
    ...overrides,
  };
}

class InMemoryCallRepository implements CallRepository {
  public context: CallContext = {
    organization: { id: ids.organization, name: "Marias Fair", lastResort: false, lastResortReason: null },
    contact: {
      id: ids.contact,
      organizationId: ids.organization,
      firstName: "Avery",
      lastName: "Example",
      jobTitle: null,
      email: null,
      phone: null,
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
    },
    booking: {
      id: ids.booking,
      organizationId: ids.organization,
      primaryContactId: ids.contact,
      name: "Marias County Fair",
      venueName: null,
      address1: null,
      city: "Shelby",
      region: "MT",
      postalCode: null,
      latitude: null,
      longitude: null,
      startsAt: null,
      endsAt: null,
      status: "possible",
      probability: "possible",
      travelLegId: null,
      notes: null,
    },
    followUp: {
      id: ids.followUp,
      bookingId: ids.booking,
      organizationId: ids.organization,
      contactId: ids.contact,
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
    },
    contactHasActiveOrganizationRelationship: true,
    contactHasBookingRelationship: true,
  };
  public readonly writes: string[] = [];
  public readonly payloads: Record<string, unknown[]> = {};
  public failWrite: string | null = null;
  public transactions = 0;
  public lockContextCalls = 0;
  private next = 1;
  private readonly completedRequests = new Map<string, {
    id: string;
    noteActivityId: string;
    disposition: "no_answer" | "left_voicemail" | "follow_up_needed" | "interested" | "proposal_sent" | "booked" | "declined" | "last_resort";
    nextFollowUpId: string | null;
    resultingBookingStatus: CompleteCallInput["resultingBookingStatus"];
  }>();

  async transaction<T>(operation: (transaction: CallTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const writes = [...this.writes];
    const context = structuredClone(this.context);
    const transaction: CallTransaction = {
      lockRequest: async (requestKey) => this.completedRequests.get(requestKey) ?? null,
      lockContext: async () => {
        this.lockContextCalls += 1;
        return context;
      },
      createActivity: async (input) => this.write(writes, "activity", { id: `activity-${this.next++}` }, input),
      createCallSession: async (input) => {
        const session = await this.write(
          writes,
          "call_session",
          { id: `call-${this.next++}` },
          input,
        );
        this.completedRequests.set(input.requestKey, {
          id: session.id,
          noteActivityId: input.noteActivityId,
          disposition: input.disposition,
          nextFollowUpId: input.nextFollowUpId,
          resultingBookingStatus: input.resultingBookingStatus,
        });
        return session;
      },
      completeFollowUp: async (id, input) => this.write(writes, "complete_follow_up", undefined, { id, input }),
      createFollowUp: async (input) => this.write(writes, "next_follow_up", { id: `follow-up-${this.next++}` }, input),
      linkNextFollowUp: async (id, nextId) => this.write(writes, "link_follow_up", undefined, { id, nextId }),
      updateBooking: async (id, updates) => this.write(writes, "booking", { ...context.booking!, ...updates, id }, updates),
      updateContact: async (input) => this.write(writes, "contact", { ...context.contact!, ...input.updates }, input),
      setLastResort: async (organizationId, reason, changedAt) => this.write(writes, "last_resort", undefined, { organizationId, reason, changedAt }),
      createAuditEntry: async (input) => this.write(writes, "audit", undefined, input),
    };
    const value = await operation(transaction);
    this.writes.length = 0;
    this.writes.push(...writes);
    return value;
  }

  private async write<T>(writes: string[], name: string, value: T, payload?: unknown): Promise<T> {
    if (this.failWrite === name) throw new Error(`${name} failed`);
    writes.push(name);
    if (payload !== undefined) (this.payloads[name] ??= []).push(payload);
    return value;
  }
}

describe("CallService.complete", () => {
  it.each([
    ["no_answer", null],
    ["left_voicemail", null],
    ["follow_up_needed", null],
    ["interested", "interested"],
    ["proposal_contract_sent", "pending_contract"],
    ["booked", "confirmed"],
    ["declined", "declined"],
    ["move_to_last_resort", "declined"],
  ] as const)("persists %s with its booking-status mapping", async (disposition, status) => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository, { now: () => new Date("2026-08-01T15:10:00.000Z") });

    const result = await service.complete(input({
      disposition,
      nextAction: disposition === "declined" || disposition === "move_to_last_resort"
        ? null
        : input().nextAction,
      lastResortReason: disposition === "move_to_last_resort" ? "Repeated cancellations." : null,
      lastResortConfirmed: disposition === "move_to_last_resort",
    }));

    expect(result).toMatchObject({ ok: true, value: { disposition, resultingBookingStatus: status } });
    expect(repository.writes).toContain("activity");
    expect(repository.writes).toContain("call_session");
    expect(repository.writes).toContain("audit");
    expect(repository.writes.includes("last_resort")).toBe(disposition === "move_to_last_resort");
    expect(repository.payloads.call_session?.[0]).toMatchObject({
      organizationId: ids.organization,
      contactId: ids.contact,
      bookingId: ids.booking,
      disposition: disposition === "proposal_contract_sent" ? "proposal_sent"
        : disposition === "move_to_last_resort" ? "last_resort"
          : disposition,
    });
  });

  it("returns a typed failure without local writes when an active call has no next action", async () => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository);

    await expect(service.complete(input({ nextAction: null }))).resolves.toEqual({
      ok: false,
      error: { code: "NEXT_ACTION_REQUIRED" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("rejects a parentless call before opening the repository transaction", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      organizationId: null,
      contactId: null,
      bookingId: null,
      followUpId: null,
      disposition: "no_answer",
      nextAction: null,
      approvedContactUpdates: null,
      approvedBookingUpdates: null,
    }))).resolves.toEqual({
      ok: false,
      error: {
        code: "INVALID_CALL_INPUT",
        message: "Link this call to an organization, contact, booking, or follow-up.",
      },
    });
    expect(repository.transactions).toBe(0);
    expect(repository.lockContextCalls).toBe(0);
    expect(repository.writes).toEqual([]);
  });

  it("completes an unorganized booking call atomically without backfilling an organization", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.organization = null;
    repository.context.contact = null;
    repository.context.booking = { ...repository.context.booking!, organizationId: null, primaryContactId: null };
    repository.context.followUp = { ...repository.context.followUp!, organizationId: null, contactId: null };
    const unorganized = {
      ...input({
        contactId: null,
        nextAction: { kind: "call", dueAt: new Date("2026-08-02T15:00:00.000Z") },
        approvedContactUpdates: null,
      }),
      organizationId: null,
    } as unknown as CompleteCallInput;

    await expect(new CallService(repository).complete(unorganized)).resolves.toMatchObject({ ok: true });
    expect(repository.writes).toEqual(expect.arrayContaining([
      "activity",
      "call_session",
      "complete_follow_up",
      "next_follow_up",
      "link_follow_up",
      "booking",
    ]));
    expect(repository.payloads.activity?.[0]).toMatchObject({ organizationId: null, bookingId: ids.booking });
    expect(repository.payloads.call_session?.[0]).toMatchObject({ organizationId: null, bookingId: ids.booking });
  });

  it("returns a typed policy error for Last Resort without an organization", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.organization = null;
    const unorganized = {
      ...input({
        disposition: "move_to_last_resort",
        nextAction: null,
        lastResortReason: "Repeated cancellations.",
        lastResortConfirmed: true,
      }),
      organizationId: null,
    } as unknown as CompleteCallInput;

    await expect(new CallService(repository).complete(unorganized)).resolves.toEqual({
      ok: false,
      error: { code: "LAST_RESORT_REQUIRES_ORGANIZATION" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("allows declined and Last Resort calls without a next action", async () => {
    const service = new CallService(new InMemoryCallRepository());

    await expect(service.complete(input({ disposition: "declined", nextAction: null }))).resolves.toMatchObject({ ok: true });
    await expect(service.complete(input({
      disposition: "move_to_last_resort",
      nextAction: null,
      lastResortReason: "Repeated cancellations.",
      lastResortConfirmed: true,
    }))).resolves.toMatchObject({ ok: true });
  });

  it("honors an explicitly supplied booking status for an unmapped disposition", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      disposition: "no_answer",
      resultingBookingStatus: "quote_sent",
    }))).resolves.toMatchObject({
      ok: true,
      value: { resultingBookingStatus: "quote_sent" },
    });
  });

  it("applies an explicitly approved closed booking update without requiring a next action", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      disposition: "no_answer",
      nextAction: null,
      approvedBookingUpdates: { status: "declined", notes: "No longer pursuing." },
    }))).resolves.toMatchObject({
      ok: true,
      value: { resultingBookingStatus: "declined" },
    });
  });

  it("persists only the approved booking key and authoritative status after merged validation", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      disposition: "proposal_contract_sent",
      approvedBookingUpdates: { notes: "  Proposal sent during call.  " },
    }))).resolves.toMatchObject({ ok: true });

    expect(repository.payloads.booking).toEqual([
      { notes: "Proposal sent during call.", status: "pending_contract" },
    ]);
  });

  it.each([
    ["interested", "possible"],
    ["proposal_contract_sent", "quote_sent"],
    ["booked", "pending_contract"],
    ["declined", "confirmed"],
    ["move_to_last_resort", "possible"],
  ] as const)("rejects a conflicting resulting status for mapped %s", async (disposition, status) => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      disposition,
      resultingBookingStatus: status,
      nextAction: disposition === "declined" || disposition === "move_to_last_resort" ? null : input().nextAction,
      lastResortReason: disposition === "move_to_last_resort" ? "Repeated cancellations." : null,
      lastResortConfirmed: disposition === "move_to_last_resort",
    }))).resolves.toEqual({ ok: false, error: { code: "RESULTING_STATUS_MISMATCH" } });
    expect(repository.writes).toEqual([]);
  });

  it.each([
    ["interested", "possible"],
    ["proposal_contract_sent", "quote_sent"],
    ["booked", "pending_contract"],
    ["declined", "confirmed"],
    ["move_to_last_resort", "possible"],
  ] as const)("rejects a conflicting approved booking status for mapped %s", async (disposition, status) => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      disposition,
      approvedBookingUpdates: { status },
      nextAction: disposition === "declined" || disposition === "move_to_last_resort" ? null : input().nextAction,
      lastResortReason: disposition === "move_to_last_resort" ? "Repeated cancellations." : null,
      lastResortConfirmed: disposition === "move_to_last_resort",
    }))).resolves.toEqual({ ok: false, error: { code: "RESULTING_STATUS_MISMATCH" } });
    expect(repository.writes).toEqual([]);
  });

  it("rejects a supplied contact from a different organization before writing", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.contact = {
      ...repository.context.contact!,
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    repository.context.contactHasActiveOrganizationRelationship = false;

    await expect(new CallService(repository).complete(input())).resolves.toEqual({
      ok: false,
      error: { code: "CONTACT_ORGANIZATION_MISMATCH" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("opens a call for a Person at a secondary active Place", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.booking = null;
    repository.context.followUp = null;
    repository.context.contact = {
      ...repository.context.contact!,
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    repository.context.contactHasActiveOrganizationRelationship = true;
    repository.context.contactHasBookingRelationship = null;

    await expect(new CallService(repository).complete(input({
      bookingId: null,
      followUpId: null,
      approvedBookingUpdates: null,
      resultingBookingStatus: null,
    }))).resolves.toMatchObject({ ok: true });
  });

  it("opens a Booking call for an additional involved Person", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.followUp = null;
    repository.context.booking = {
      ...repository.context.booking!,
      primaryContactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    repository.context.contactHasActiveOrganizationRelationship = true;
    repository.context.contactHasBookingRelationship = true;

    await expect(new CallService(repository).complete(input({
      followUpId: null,
    }))).resolves.toMatchObject({ ok: true });
  });

  it("rejects a call when the Place-Person relationship is inactive", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.booking = null;
    repository.context.followUp = null;
    repository.context.contactHasActiveOrganizationRelationship = false;
    repository.context.contactHasBookingRelationship = null;

    await expect(new CallService(repository).complete(input({
      bookingId: null,
      followUpId: null,
      approvedBookingUpdates: null,
      resultingBookingStatus: null,
    }))).resolves.toEqual({
      ok: false,
      error: { code: "CONTACT_ORGANIZATION_MISMATCH" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("rejects a follow-up linked to a different organization before writing", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.followUp = {
      ...repository.context.followUp!,
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };

    await expect(new CallService(repository).complete(input())).resolves.toEqual({
      ok: false,
      error: { code: "FOLLOW_UP_ORGANIZATION_MISMATCH" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("rejects a supplied booking from a different organization before writing", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.booking = {
      ...repository.context.booking!,
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };

    await expect(new CallService(repository).complete(input())).resolves.toEqual({
      ok: false,
      error: { code: "BOOKING_ORGANIZATION_MISMATCH" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("rejects a supplied contact that differs from the current follow-up", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.followUp = {
      ...repository.context.followUp!,
      contactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };

    await expect(new CallService(repository).complete(input())).resolves.toEqual({
      ok: false,
      error: { code: "FOLLOW_UP_CONTACT_MISMATCH" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("rejects an unrelated unorganized contact attached to an ad-hoc booking", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.organization = null;
    repository.context.booking = {
      ...repository.context.booking!,
      organizationId: null,
      primaryContactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    repository.context.contact = {
      ...repository.context.contact!,
      organizationId: null,
    };
    repository.context.contactHasBookingRelationship = false;
    repository.context.followUp = null;

    await expect(new CallService(repository).complete(input({
      organizationId: null,
      followUpId: null,
    }))).resolves.toEqual({
      ok: false,
      error: { code: "CONTACT_BOOKING_MISMATCH" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("rejects added booking and contact parents for an organization-only follow-up", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.followUp = {
      ...repository.context.followUp!,
      bookingId: null,
      contactId: null,
    };

    await expect(new CallService(repository).complete(input())).resolves.toEqual({
      ok: false,
      error: { code: "FOLLOW_UP_BOOKING_MISMATCH" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("requires a future next action for an active contact-only call", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.organization = null;
    repository.context.booking = null;
    repository.context.followUp = null;
    repository.context.contact = {
      ...repository.context.contact!,
      organizationId: null,
    };

    await expect(new CallService(repository, {
      now: () => new Date("2026-08-01T15:10:00.000Z"),
    }).complete(input({
      organizationId: null,
      bookingId: null,
      followUpId: null,
      approvedBookingUpdates: null,
      nextAction: null,
    }))).resolves.toEqual({
      ok: false,
      error: { code: "NEXT_ACTION_REQUIRED" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("rejects malformed approved contact email before local writes", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      approvedContactUpdates: { email: "not-an-email" },
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CALL_INPUT" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("normalizes approved contact email and persists only the approved key", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      approvedContactUpdates: { email: "  AVERY@EXAMPLE.COM  " },
    }))).resolves.toMatchObject({ ok: true });
    expect(repository.payloads.contact?.[0]).toMatchObject({
      updates: { email: "avery@example.com" },
    });
  });

  it("returns the first completed call for a sequential request replay without new writes", async () => {
    const repository = new InMemoryCallRepository();
    const service = new CallService(repository);

    const first = await service.complete(input());
    const writeCount = repository.writes.length;
    const replay = await service.complete(input());

    expect(first).toMatchObject({ ok: true });
    expect(replay).toMatchObject({
      ok: true,
      value: {
        activityId: first.ok ? first.value.activityId : "",
        callSessionId: first.ok ? first.value.callSessionId : "",
        nextFollowUpId: first.ok ? first.value.nextFollowUpId : "",
        resultingBookingStatus: first.ok
          ? first.value.resultingBookingStatus
          : null,
      },
    });
    expect(repository.writes).toHaveLength(writeCount);
  });

  it("rejects a booking patch that leaves only one coordinate", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      approvedBookingUpdates: { latitude: 46.8 },
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CALL_INPUT" },
    });
    expect(repository.writes).toEqual([]);
  });

  it("protects an already completed follow-up before writing the call", async () => {
    const repository = new InMemoryCallRepository();
    repository.context.followUp!.completedAt = new Date("2026-08-01T14:00:00.000Z");

    await expect(new CallService(repository).complete(input())).resolves.toEqual({
      ok: false,
      error: { code: "ALREADY_COMPLETED" },
    });
    expect(repository.writes).toEqual([]);
  });

  it.each([
    "activity",
    "call_session",
    "complete_follow_up",
    "next_follow_up",
    "link_follow_up",
    "booking",
    "contact",
    "audit",
  ])("rolls every local write back when %s fails", async (failedWrite) => {
    const repository = new InMemoryCallRepository();
    repository.failWrite = failedWrite;

    await expect(new CallService(repository).complete(input())).rejects.toThrow(`${failedWrite} failed`);
    expect(repository.writes).toEqual([]);
  });

  it("rolls the Last Resort update back when it fails", async () => {
    const repository = new InMemoryCallRepository();
    repository.failWrite = "last_resort";

    await expect(new CallService(repository).complete(input({
      disposition: "move_to_last_resort",
      nextAction: null,
      lastResortReason: "Repeated cancellations.",
      lastResortConfirmed: true,
    }))).rejects.toThrow("last_resort failed");
    expect(repository.writes).toEqual([]);
  });
});

describe("DrizzleCallRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    const schema = `"${schemaName}"`;
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    await sql.unsafe(`SET search_path TO ${schema}, public`);
    const journal = JSON.parse(
      await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
        await sql.unsafe(statement);
      }
    }
    const db = drizzle({ client: sql, schema: crmSchema });
    await db.insert(crmSchema.organizations).values({ id: ids.organization, name: "Marias Fair" });
    await db.insert(crmSchema.contacts).values({
      id: ids.contact,
      organizationId: null,
      firstName: "Avery",
      lastName: "Example",
    });
    await db.insert(crmSchema.organizationContacts).values({
      organizationId: ids.organization,
      contactId: ids.contact,
      active: true,
      source: "legacy_backfill",
    });
    await sql.unsafe(`
      UPDATE contacts SET organization_id = '${ids.organization}' WHERE id = '${ids.contact}'
    `);
    await db.insert(crmSchema.bookings).values({
      id: ids.booking,
      organizationId: ids.organization,
      primaryContactId: null,
      name: "Marias County Fair",
      venueName: "Do Not Rewrite Venue",
      address1: "17 Sentinel Road",
      city: "Sentinel City",
      region: "mT",
      postalCode: "59999",
      latitude: 46.85,
      longitude: -111.99,
      startsAt: new Date("2026-08-15T15:00:00.000Z"),
      endsAt: new Date("2026-08-16T15:00:00.000Z"),
      status: "possible",
      probability: "unlikely",
      notes: "Original notes must survive.",
    });
    await db.insert(crmSchema.bookingContacts).values({
      bookingId: ids.booking,
      contactId: ids.contact,
      isPrimary: true,
      source: "legacy_backfill",
    });
    await sql.unsafe(`
      UPDATE bookings SET primary_contact_id = '${ids.contact}' WHERE id = '${ids.booking}'
    `);
    await db.insert(crmSchema.followUps).values({
      id: ids.followUp,
      organizationId: ids.organization,
      contactId: ids.contact,
      bookingId: ids.booking,
      kind: "call",
      dueAt: new Date("2026-08-02T15:00:00.000Z"),
    });
  });

  afterEach(async () => {
    if (!sql) return;
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await sql.end({ timeout: 5 });
      sql = undefined;
    }
  });

  postgresTest("persists the linked activity, session, follow-ups, approved patches, and audits together", async () => {
    const db = drizzle({ client: sql!, schema: crmSchema });
    const service = new CallService(new DrizzleCallRepository(db), {
      now: () => new Date("2026-08-01T15:10:00.000Z"),
    });

    await expect(service.complete(input({
      disposition: "proposal_contract_sent",
      approvedContactUpdates: { phone: "406-555-0101", jobTitle: "Events Director" },
      approvedBookingUpdates: { notes: "Proposal sent during call." },
    }))).resolves.toMatchObject({
      ok: true,
      value: { disposition: "proposal_contract_sent", resultingBookingStatus: "pending_contract" },
    });

    expect(await sql!.unsafe("SELECT kind, body, organization_id, contact_id, booking_id FROM activities")).toEqual([
      {
        kind: "call",
        body: "Confirmed the August event.",
        organization_id: ids.organization,
        contact_id: ids.contact,
        booking_id: ids.booking,
      },
    ]);
    expect(await sql!.unsafe("SELECT disposition, follow_up_id FROM call_sessions")).toEqual([
      { disposition: "proposal_sent", follow_up_id: ids.followUp },
    ]);
    expect(await sql!.unsafe(`SELECT completed_at, outcome, next_follow_up_id FROM follow_ups WHERE id = '${ids.followUp}'`)).toEqual([
      { completed_at: new Date("2026-08-01T15:10:00.000Z"), outcome: "proposal_contract_sent", next_follow_up_id: expect.any(String) },
    ]);
    expect(await sql!.unsafe("SELECT kind, booking_id, organization_id, contact_id FROM follow_ups WHERE id <> $1", [ids.followUp])).toEqual([
      { kind: "send quote", booking_id: ids.booking, organization_id: ids.organization, contact_id: ids.contact },
    ]);
    expect(await sql!.unsafe(`SELECT status, notes, venue_name, address_1, city, region, postal_code, latitude, longitude, starts_at, ends_at, probability FROM bookings WHERE id = '${ids.booking}'`)).toEqual([
      {
        status: "pending_contract",
        notes: "Proposal sent during call.",
        venue_name: "Do Not Rewrite Venue",
        address_1: "17 Sentinel Road",
        city: "Sentinel City",
        region: "mT",
        postal_code: "59999",
        latitude: 46.85,
        longitude: -111.99,
        starts_at: new Date("2026-08-15T15:00:00.000Z"),
        ends_at: new Date("2026-08-16T15:00:00.000Z"),
        probability: "unlikely",
      },
    ]);
    expect(await sql!.unsafe(`SELECT phone, normalized_phone FROM contacts WHERE id = '${ids.contact}'`)).toEqual([
      { phone: "406-555-0101", normalized_phone: "+14065550101" },
    ]);
    expect(await sql!.unsafe(`SELECT local_dirty, state FROM act_contact_sync_states WHERE contact_id = '${ids.contact}'`)).toEqual([
      { local_dirty: true, state: "waiting" },
    ]);
    expect(await sql!.unsafe("SELECT entity_type, action FROM audit_entries ORDER BY entity_type, action")).toEqual([
      { entity_type: "activity", action: "create" },
      { entity_type: "booking", action: "update" },
      { entity_type: "call_session", action: "create" },
      { entity_type: "contact", action: "update" },
      { entity_type: "follow_up", action: "completed" },
      { entity_type: "follow_up", action: "create" },
    ]);
  });

  postgresTest("serializes concurrent completion replays to one call write set", async () => {
    const secondSql = postgres(databaseUrl!, { max: 1 });
    try {
      await secondSql.unsafe(`SET search_path TO "${schemaName}", public`);
      const firstService = new CallService(
        new DrizzleCallRepository(drizzle({ client: sql!, schema: crmSchema })),
        { now: () => new Date("2026-08-01T15:10:00.000Z") },
      );
      const secondService = new CallService(
        new DrizzleCallRepository(
          drizzle({ client: secondSql, schema: crmSchema }),
        ),
        { now: () => new Date("2026-08-01T15:10:00.000Z") },
      );

      const [first, replay] = await Promise.all([
        firstService.complete(input()),
        secondService.complete(input()),
      ]);

      expect(first).toMatchObject({ ok: true });
      expect(replay).toMatchObject({ ok: true });
      if (!first.ok || !replay.ok) throw new Error("Expected completed calls.");
      expect(replay.value.callSessionId).toBe(first.value.callSessionId);
      expect(replay.value.activityId).toBe(first.value.activityId);
      expect(replay.value.nextFollowUpId).toBe(first.value.nextFollowUpId);
      expect(replay.value.resultingBookingStatus).toBe(
        first.value.resultingBookingStatus,
      );
      expect(await sql!.unsafe("SELECT count(*) AS value FROM call_sessions")).toEqual([
        { value: "1" },
      ]);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([
        { value: "1" },
      ]);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM follow_ups")).toEqual([
        { value: "2" },
      ]);
    } finally {
      await secondSql.end({ timeout: 5 });
    }
  });

  postgresTest("rolls call activity, session, follow-up, booking, contact, and Last Resort updates back together", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_call_session_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.entity_type = 'call_session' THEN RAISE EXCEPTION 'call audit rejected'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_call_session_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_call_session_audit();
    `);
    const db = drizzle({ client: sql!, schema: crmSchema });
    const service = new CallService(new DrizzleCallRepository(db), {
      now: () => new Date("2026-08-01T15:10:00.000Z"),
    });

    await expect(service.complete(input({
      disposition: "move_to_last_resort",
      lastResortReason: "Repeated cancellations.",
      lastResortConfirmed: true,
      approvedContactUpdates: { phone: "406-555-0101" },
      approvedBookingUpdates: { notes: "This must roll back." },
    }))).rejects.toThrow("call audit rejected");

    expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM call_sessions")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe(`SELECT completed_at, next_follow_up_id FROM follow_ups WHERE id = '${ids.followUp}'`)).toEqual([
      { completed_at: null, next_follow_up_id: null },
    ]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM follow_ups")).toEqual([{ value: "1" }]);
    expect(await sql!.unsafe(`SELECT status, notes FROM bookings WHERE id = '${ids.booking}'`)).toEqual([
      { status: "possible", notes: "Original notes must survive." },
    ]);
    expect(await sql!.unsafe(`SELECT phone, normalized_phone FROM contacts WHERE id = '${ids.contact}'`)).toEqual([
      { phone: null, normalized_phone: null },
    ]);
    expect(await sql!.unsafe(`SELECT count(*) AS value FROM act_contact_sync_states WHERE contact_id = '${ids.contact}'`)).toEqual([
      { value: "0" },
    ]);
    expect(await sql!.unsafe(`SELECT last_resort, last_resort_reason FROM organizations WHERE id = '${ids.organization}'`)).toEqual([
      { last_resort: false, last_resort_reason: null },
    ]);
  });
});
