import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import { MigrationRelationshipApplyRepository } from "@/features/act-migration/relationship-apply-repository";
import type { MigrationApplyOperation } from "@/features/act-migration/apply-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const runId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";
const placeId = "33333333-3333-4333-8333-333333333333";
const personId = "44444444-4444-4444-8444-444444444444";

function schemaName() { return `act_relationship_apply_${randomUUID().replaceAll("-", "_")}`; }
async function statements(file: string, schema: string) {
  return (await readFile(path.join(migrationDirectory, file), "utf8"))
    .replaceAll('"public".', `"${schema}".`).split("--> statement-breakpoint")
    .map((value) => value.trim()).filter(Boolean);
}

function operation(input: {
  proposalKey: string;
  targetEntityType: "organization_contact" | "booking" | "booking_contact";
  sourceRecordKeys: string[];
  dependencyProposalKeys: string[];
  displaySnapshot?: Record<string, string | number | boolean | null>;
}): MigrationApplyOperation {
  return {
    id: randomUUID(), batchId, runId, proposalKey: input.proposalKey,
    targetEntityType: input.targetEntityType, dependencyProposalKeys: input.dependencyProposalKeys,
    status: "leased", attemptCount: 1, leaseOwner: "worker", leaseExpiresAt: null,
    appliedEntityId: null, errorCode: null, retryable: true,
    proposal: {
      proposalKey: input.proposalKey, state: "new_relationship", reviewState: "decided",
      targetEntityType: input.targetEntityType, sourceRecordKeys: input.sourceRecordKeys,
      candidateLocalIds: [], proposedLocalId: null, proposedPrimarySourceId: null,
      issueCode: null, dependencyProposalKeys: input.dependencyProposalKeys, matchReason: "fixture",
      displaySnapshot: input.displaySnapshot ?? {}, decision: "approve_proposed",
      chosenLocalEntityId: null, primarySourceId: null,
    },
  };
}

describe("MigrationRelationshipApplyRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let database: ReturnType<typeof drizzle<typeof crmSchema>>;
  let repository: MigrationRelationshipApplyRepository;
  let currentSchema = "";

  beforeEach(async () => {
    if (!databaseUrl) return;
    currentSchema = schemaName();
    const setup = postgres(databaseUrl, { max: 1 });
    try {
      await setup.unsafe(`CREATE SCHEMA "${currentSchema}"`);
      const journal = JSON.parse(await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
      for (const entry of journal.entries) for (const statement of await statements(`${entry.tag}.sql`, currentSchema)) await setup.unsafe(statement);
    } finally { await setup.end({ timeout: 5 }); }
    sql = postgres(databaseUrl, { max: 4, connection: { search_path: `${currentSchema},public` } });
    database = drizzle({ client: sql, schema: crmSchema });
    repository = new MigrationRelationshipApplyRepository(database);
    await database.insert(crmSchema.actMigrationRuns).values({ id: runId, requestKey: randomUUID(), sourceDatabaseKey: "test", requestedBy: "owner", status: "applying" });
    await database.insert(crmSchema.actMigrationApplyBatches).values({ id: batchId, requestKey: randomUUID(), runId, requestedBy: "owner", status: "applying", manifestDigest: "fixture" });
    await database.insert(crmSchema.organizations).values({ id: placeId, name: "Place", city: "Denver", region: "CO" });
    await database.insert(crmSchema.contacts).values({ id: personId, firstName: "Avery", lastName: "Person" });
    await database.insert(crmSchema.actMigrationApplyOperations).values([
      { batchId, runId, proposalKey: "organization:place", targetEntityType: "organization", status: "applied", retryable: false, appliedEntityId: placeId },
      { batchId, runId, proposalKey: "contact:person", targetEntityType: "contact", status: "applied", retryable: false, appliedEntityId: personId },
    ]);
  });
  afterEach(async () => { if (!sql) return; try { await sql.unsafe(`DROP SCHEMA IF EXISTS "${currentSchema}" CASCADE`); } finally { await sql.end({ timeout: 5 }); sql = undefined; } });

  postgresTest("reactivates an approved Place-Person relationship and synchronizes an approved primary pointer", async () => {
    await database.insert(crmSchema.organizationContacts).values({ organizationId: placeId, contactId: personId, active: false, isPrimary: false, source: "local" });
    await database.insert(crmSchema.actMigrationRecords).values({ runId, streamType: "company_contact", sourceKey: "company_contact:PLACE:PERSON", sourceId: "PLACE", targetSourceId: "PERSON", rawSnapshot: {}, normalizedSnapshot: { sourceId: "PLACE", targetSourceId: "PERSON" }, fingerprint: "relationship" });

    const value = operation({ proposalKey: "organization_contact:place-person", targetEntityType: "organization_contact", sourceRecordKeys: ["company_contact:PLACE:PERSON"], dependencyProposalKeys: ["organization:place", "contact:person"], displaySnapshot: { isPrimary: true } });
    const applied = await Promise.all([
      repository.applyOrganizationContact(value),
      repository.applyOrganizationContact(value),
    ]);
    expect(applied).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: expect.any(String), changed: true }),
      expect.objectContaining({ entityId: expect.any(String), changed: false }),
    ]));
    expect(await database.select().from(crmSchema.organizationContacts).where(and(eq(crmSchema.organizationContacts.organizationId, placeId), eq(crmSchema.organizationContacts.contactId, personId)))).toMatchObject([{ active: true, isPrimary: true, source: "act_migration" }]);
    expect(await database.select({ organizationId: crmSchema.contacts.organizationId }).from(crmSchema.contacts).where(eq(crmSchema.contacts.id, personId))).toEqual([{ organizationId: placeId }]);
    await expect(repository.applyOrganizationContact(value)).resolves.toMatchObject({ changed: false });
  });

  postgresTest("creates a Booking from dependency IDs without a Person and retains unrelated operational history on retry", async () => {
    await database.insert(crmSchema.actMigrationRecords).values({ runId, streamType: "opportunity", sourceKey: "opportunity:OPPORTUNITY", sourceId: "OPPORTUNITY", rawSnapshot: { name: "Do not use" }, normalizedSnapshot: { displayName: "ACT Opportunity", estimatedCloseDate: "2026-09-10T00:00:00.000Z", actualCloseDate: null }, fingerprint: "opportunity" });
    const value = operation({ proposalKey: "booking:opportunity", targetEntityType: "booking", sourceRecordKeys: ["opportunity:OPPORTUNITY"], dependencyProposalKeys: ["organization:place"] });

    const applied = await repository.applyBooking(value);
    expect(applied.changed).toBe(true);
    const [booking] = await database.select().from(crmSchema.bookings).where(eq(crmSchema.bookings.id, applied.entityId));
    expect(booking).toMatchObject({ organizationId: placeId, primaryContactId: null, name: "ACT Opportunity", city: "Denver", region: "CO", status: "new_lead", probability: "possible" });
    const travelLegId = "55555555-5555-4555-8555-555555555555";
    await database.insert(crmSchema.travelLegs).values({ id: travelLegId, name: "Local route", color: "#123456", sortOrder: 1 });
    await database.update(crmSchema.bookings).set({ notes: "local notes", travelLegId, physicalAttractionTotal: 7 }).where(eq(crmSchema.bookings.id, applied.entityId));
    await database.insert(crmSchema.activities).values({ organizationId: placeId, contactId: personId, bookingId: applied.entityId, kind: "note", body: "Existing activity", occurredAt: new Date("2026-08-01T00:00:00.000Z") });
    const [followUp] = await database.insert(crmSchema.followUps).values({ organizationId: placeId, contactId: personId, bookingId: applied.entityId, kind: "call", dueAt: new Date("2026-08-02T00:00:00.000Z") }).returning();
    await database.insert(crmSchema.callSessions).values({ organizationId: placeId, contactId: personId, bookingId: applied.entityId, followUpId: followUp!.id, disposition: "no_answer", startedAt: new Date("2026-08-01T01:00:00.000Z") });
    await expect(repository.applyBooking(value)).resolves.toEqual({ entityId: applied.entityId, changed: false });
    expect(await database.select({ notes: crmSchema.bookings.notes, travelLegId: crmSchema.bookings.travelLegId, total: crmSchema.bookings.physicalAttractionTotal }).from(crmSchema.bookings).where(eq(crmSchema.bookings.id, applied.entityId))).toEqual([{ notes: "local notes", travelLegId, total: 7 }]);
    expect(await database.select({ id: crmSchema.activities.id }).from(crmSchema.activities).where(eq(crmSchema.activities.bookingId, applied.entityId))).toHaveLength(1);
    expect(await database.select({ id: crmSchema.followUps.id }).from(crmSchema.followUps).where(eq(crmSchema.followUps.bookingId, applied.entityId))).toHaveLength(1);
    expect(await database.select({ id: crmSchema.callSessions.id }).from(crmSchema.callSessions).where(eq(crmSchema.callSessions.bookingId, applied.entityId))).toHaveLength(1);
  });

  postgresTest("requires an applied Place and synchronizes an approved primary Booking-Person relationship", async () => {
    await database.insert(crmSchema.actMigrationRecords).values([
      { runId, streamType: "opportunity", sourceKey: "opportunity:OPPORTUNITY", sourceId: "OPPORTUNITY", rawSnapshot: {}, normalizedSnapshot: { displayName: "ACT Opportunity", estimatedCloseDate: null, actualCloseDate: null }, fingerprint: "opportunity" },
      { runId, streamType: "opportunity_contact", sourceKey: "opportunity_contact:OPPORTUNITY:PERSON", sourceId: "OPPORTUNITY", targetSourceId: "PERSON", rawSnapshot: {}, normalizedSnapshot: { sourceId: "OPPORTUNITY", targetSourceId: "PERSON" }, fingerprint: "booking-person" },
    ]);
    const missingPlace = operation({ proposalKey: "booking:missing-place", targetEntityType: "booking", sourceRecordKeys: ["opportunity:OPPORTUNITY"], dependencyProposalKeys: [] });
    await expect(repository.applyBooking(missingPlace)).rejects.toThrow("dependency");
    const booking = await repository.applyBooking(operation({ proposalKey: "booking:opportunity", targetEntityType: "booking", sourceRecordKeys: ["opportunity:OPPORTUNITY"], dependencyProposalKeys: ["organization:place"] }));
    await database.insert(crmSchema.actMigrationApplyOperations).values({ batchId, runId, proposalKey: "booking:opportunity", targetEntityType: "booking", status: "applied", retryable: false, appliedEntityId: booking.entityId });
    const relationship = operation({ proposalKey: "booking_contact:opportunity-person", targetEntityType: "booking_contact", sourceRecordKeys: ["opportunity_contact:OPPORTUNITY:PERSON"], dependencyProposalKeys: ["booking:opportunity", "contact:person"], displaySnapshot: { isPrimary: true, role: "Coordinator" } });
    await expect(repository.applyBookingContact(relationship)).resolves.toMatchObject({ changed: true });
    expect(await database.select().from(crmSchema.bookingContacts).where(eq(crmSchema.bookingContacts.bookingId, booking.entityId))).toMatchObject([{ contactId: personId, isPrimary: true, role: "Coordinator", source: "act_migration" }]);
    expect(await database.select({ primaryContactId: crmSchema.bookings.primaryContactId }).from(crmSchema.bookings).where(eq(crmSchema.bookings.id, booking.entityId))).toEqual([{ primaryContactId: personId }]);
  });
});
