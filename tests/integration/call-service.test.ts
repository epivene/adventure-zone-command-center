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

const databaseUrl = process.env.CALL_REPOSITORY_TEST_DATABASE_URL;
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
    approvedContactUpdates: { phone: "555-0123" },
    approvedBookingUpdates: { notes: "Confirmed on call" },
    ...overrides,
  };
}

class InMemoryCallRepository implements CallRepository {
  public context: CallContext = {
    organization: { id: ids.organization, lastResort: false, lastResortReason: null },
    contact: { id: ids.contact },
    booking: { id: ids.booking, status: "possible" },
    followUp: {
      id: ids.followUp,
      bookingId: ids.booking,
      organizationId: ids.organization,
      contactId: ids.contact,
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
    },
  };
  public readonly writes: string[] = [];
  public failWrite: string | null = null;
  public transactions = 0;
  private next = 1;

  async transaction<T>(operation: (transaction: CallTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const writes = [...this.writes];
    const context = structuredClone(this.context);
    const transaction: CallTransaction = {
      lockContext: async () => context,
      createActivity: async () => this.write(writes, "activity", { id: `activity-${this.next++}` }),
      createCallSession: async () => this.write(writes, "call_session", { id: `call-${this.next++}` }),
      completeFollowUp: async () => this.write(writes, "complete_follow_up", undefined),
      createFollowUp: async () => this.write(writes, "next_follow_up", { id: `follow-up-${this.next++}` }),
      linkNextFollowUp: async () => this.write(writes, "link_follow_up", undefined),
      updateBooking: async () => this.write(writes, "booking", { id: ids.booking, status: "possible" as const }),
      updateContact: async () => this.write(writes, "contact", undefined),
      setLastResort: async () => this.write(writes, "last_resort", undefined),
      createAuditEntry: async () => this.write(writes, "audit", undefined),
    };
    const value = await operation(transaction);
    this.writes.length = 0;
    this.writes.push(...writes);
    return value;
  }

  private async write<T>(writes: string[], name: string, value: T): Promise<T> {
    if (this.failWrite === name) throw new Error(`${name} failed`);
    writes.push(name);
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
    }));

    expect(result).toMatchObject({ ok: true, value: { disposition, resultingBookingStatus: status } });
    expect(repository.writes).toContain("activity");
    expect(repository.writes).toContain("call_session");
    expect(repository.writes).toContain("audit");
    expect(repository.writes.includes("last_resort")).toBe(disposition === "move_to_last_resort");
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

  it("allows declined and Last Resort calls without a next action", async () => {
    const service = new CallService(new InMemoryCallRepository());

    await expect(service.complete(input({ disposition: "declined", nextAction: null }))).resolves.toMatchObject({ ok: true });
    await expect(service.complete(input({
      disposition: "move_to_last_resort",
      nextAction: null,
      lastResortReason: "Repeated cancellations.",
    }))).resolves.toMatchObject({ ok: true });
  });

  it("honors the explicitly mapped booking status supplied by the caller", async () => {
    const repository = new InMemoryCallRepository();

    await expect(new CallService(repository).complete(input({
      disposition: "proposal_contract_sent",
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
      organizationId: ids.organization,
      firstName: "Avery",
      lastName: "Example",
    });
    await db.insert(crmSchema.bookings).values({
      id: ids.booking,
      organizationId: ids.organization,
      primaryContactId: ids.contact,
      name: "Marias County Fair",
      city: "Shelby",
      region: "MT",
      status: "possible",
    });
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
      nextAction: null,
      lastResortReason: "Repeated cancellations.",
    }))).rejects.toThrow("call audit rejected");

    expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM call_sessions")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe(`SELECT completed_at, next_follow_up_id FROM follow_ups WHERE id = '${ids.followUp}'`)).toEqual([
      { completed_at: null, next_follow_up_id: null },
    ]);
    expect(await sql!.unsafe(`SELECT status, notes FROM bookings WHERE id = '${ids.booking}'`)).toEqual([
      { status: "possible", notes: null },
    ]);
    expect(await sql!.unsafe(`SELECT last_resort, last_resort_reason FROM organizations WHERE id = '${ids.organization}'`)).toEqual([
      { last_resort: false, last_resort_reason: null },
    ]);
  });
});
