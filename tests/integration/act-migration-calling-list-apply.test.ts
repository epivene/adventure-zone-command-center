import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import type { MigrationApplyOperation } from "@/features/act-migration/apply-repository";
import { MigrationCallingListApplyRepository } from "@/features/act-migration/calling-list-apply-repository";
import { CallingListRepository } from "@/features/calling-lists/calling-list-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const runId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";
const personId = "33333333-3333-4333-8333-333333333333";

function schemaName() { return `act_calling_list_apply_${randomUUID().replaceAll("-", "_")}`; }
async function statements(file: string, schema: string) {
  return (await readFile(path.join(migrationDirectory, file), "utf8"))
    .replaceAll('"public".', `"${schema}".`).split("--> statement-breakpoint")
    .map((value) => value.trim()).filter(Boolean);
}

function operation(input: {
  proposalKey: string;
  targetEntityType: "calling_list" | "calling_list_member";
  sourceRecordKeys: string[];
  dependencyProposalKeys?: string[];
  decision?: "approve_proposed" | "confirm_static_group";
}): MigrationApplyOperation {
  return {
    id: randomUUID(), batchId, runId, proposalKey: input.proposalKey,
    targetEntityType: input.targetEntityType, dependencyProposalKeys: input.dependencyProposalKeys ?? [],
    status: "leased", attemptCount: 1, leaseOwner: "worker", leaseExpiresAt: null,
    appliedEntityId: null, errorCode: null, retryable: true,
    proposal: {
      proposalKey: input.proposalKey,
      state: input.targetEntityType === "calling_list" ? "needs_review" : "new_relationship",
      reviewState: "decided", targetEntityType: input.targetEntityType,
      sourceRecordKeys: input.sourceRecordKeys, candidateLocalIds: [], proposedLocalId: null,
      proposedPrimarySourceId: null, issueCode: "group_membership_semantics_unknown",
      dependencyProposalKeys: input.dependencyProposalKeys ?? [], matchReason: "fixture",
      displaySnapshot: input.targetEntityType === "calling_list" ? { name: "Legacy Group", membershipSemantics: "unknown" } : { membershipSemantics: "unknown" },
      decision: input.decision ?? null, chosenLocalEntityId: null, primarySourceId: null,
    },
  };
}

async function confirmedListProposal(database: ReturnType<typeof drizzle<typeof crmSchema>>, proposalKey: string) {
  await database.insert(crmSchema.actMigrationProposals).values({
    runId, proposalKey, state: "needs_review", reviewState: "decided", targetEntityType: "calling_list",
    sourceRecordKeys: ["group:GROUP-1"], candidateLocalIds: [], dependencyProposalKeys: [],
    matchReason: "fixture", displaySnapshot: {}, decision: "confirm_static_group",
  });
}

describe("MigrationCallingListApplyRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let database: ReturnType<typeof drizzle<typeof crmSchema>>;
  let lists: CallingListRepository;
  let repository: MigrationCallingListApplyRepository;
  let currentSchema = "";

  beforeEach(async () => {
    if (!databaseUrl) return;
    currentSchema = schemaName();
    const setup = postgres(databaseUrl, { max: 1, connection: { search_path: `${currentSchema},public` } });
    try {
      await setup.unsafe(`CREATE SCHEMA "${currentSchema}"`);
      const journal = JSON.parse(await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
      for (const entry of journal.entries) for (const statement of await statements(`${entry.tag}.sql`, currentSchema)) await setup.unsafe(statement);
    } finally { await setup.end({ timeout: 5 }); }
    sql = postgres(databaseUrl, { max: 4, connection: { search_path: `${currentSchema},public` } });
    database = drizzle({ client: sql, schema: crmSchema });
    lists = new CallingListRepository(database);
    repository = new MigrationCallingListApplyRepository(database, lists);
    await database.insert(crmSchema.actMigrationRuns).values({ id: runId, requestKey: randomUUID(), sourceDatabaseKey: "test", requestedBy: "owner", status: "applying" });
    await database.insert(crmSchema.actMigrationApplyBatches).values({ id: batchId, requestKey: randomUUID(), runId, requestedBy: "owner", status: "applying", manifestDigest: "fixture" });
    await database.insert(crmSchema.contacts).values({ id: personId, firstName: "Avery", lastName: "Person" });
    await database.insert(crmSchema.actMigrationRecords).values([
      { runId, streamType: "group", sourceKey: "group:GROUP-1", sourceId: "GROUP-1", rawSnapshot: {}, normalizedSnapshot: { displayName: "Legacy Group", membershipSemantics: "unknown" }, fingerprint: "group" },
      { runId, streamType: "group_contact", sourceKey: "group_contact:GROUP-1:CONTACT-1", sourceId: "GROUP-1", targetSourceId: "CONTACT-1", rawSnapshot: {}, normalizedSnapshot: { sourceId: "GROUP-1", targetSourceId: "CONTACT-1", membershipSemantics: "unknown" }, fingerprint: "membership" },
    ]);
  });
  afterEach(async () => { if (!sql) return; try { await sql.unsafe(`DROP SCHEMA IF EXISTS "${currentSchema}" CASCADE`); } finally { await sql.end({ timeout: 5 }); sql = undefined; } });

  postgresTest("rejects an unknown-semantics Group until it is explicitly confirmed, then creates a pull-only static list", async () => {
    const unconfirmed = operation({ proposalKey: "calling_list:GROUP-1", targetEntityType: "calling_list", sourceRecordKeys: ["group:GROUP-1"] });
    await expect(repository.applyCallingList(unconfirmed)).rejects.toThrow("confirm");

    const confirmed = operation({ proposalKey: "calling_list:GROUP-1", targetEntityType: "calling_list", sourceRecordKeys: ["group:GROUP-1"], decision: "confirm_static_group" });
    const applied = await repository.applyCallingList(confirmed);
    expect(applied).toMatchObject({ changed: true });
    expect(await database.select().from(crmSchema.callingLists).where(eq(crmSchema.callingLists.id, applied.entityId))).toMatchObject([{ name: "Legacy Group", kind: "static", filterDefinition: null }]);
    expect(await database.select().from(crmSchema.actExternalLinks).where(and(eq(crmSchema.actExternalLinks.entityId, applied.entityId), eq(crmSchema.actExternalLinks.actRecordId, "GROUP-1")))).toMatchObject([{ entityType: "calling_list", sourceEntityType: "group", syncMode: "pull_only", migrationRunId: runId }]);
    await expect(repository.applyCallingList(confirmed)).resolves.toEqual({ entityId: applied.entityId, changed: false });
  });

  postgresTest("validates dynamic filters and refuses to repurpose a manually linked list", async () => {
    await expect(lists.createOrVerifyDynamicList({ name: "Invalid", sourceId: "DYNAMIC-1", runId, filterDefinition: { version: 1, entity: "person", where: { op: "predicate", field: "person.email", operator: "eq", value: "bad" } } })).rejects.toThrow();
    const dynamic = await lists.createOrVerifyDynamicList({ name: "Colorado", sourceId: "DYNAMIC-1", runId, filterDefinition: { version: 1, entity: "person", where: { op: "predicate", field: "person.region", operator: "eq", value: "CO" } } });
    await expect(lists.createOrVerifyDynamicList({ name: "Colorado", sourceId: "DYNAMIC-1", runId, filterDefinition: { version: 1, entity: "person", where: { op: "predicate", field: "person.city", operator: "eq", value: "Denver" } } })).rejects.toThrow("filter");
    const manual = (await database.insert(crmSchema.callingLists).values({ name: "Manual", kind: "static" }).returning())[0]!;
    await database.insert(crmSchema.actExternalLinks).values({ entityType: "calling_list", sourceEntityType: "group", entityId: manual.id, actRecordId: "MANUAL-1", syncMode: "pull_only" });
    await expect(lists.createOrVerifyStaticList({ name: "Replacement", sourceId: "MANUAL-1", runId })).rejects.toThrow("manual");
    expect(dynamic.changed).toBe(true);
  });

  postgresTest("applies one static membership at most once and preserves a manual membership", async () => {
    const list = await repository.applyCallingList(operation({ proposalKey: "calling_list:GROUP-1", targetEntityType: "calling_list", sourceRecordKeys: ["group:GROUP-1"], decision: "confirm_static_group" }));
    await confirmedListProposal(database, "calling_list:GROUP-1");
    await database.insert(crmSchema.actMigrationApplyOperations).values([
      { batchId, runId, proposalKey: "calling_list:GROUP-1", targetEntityType: "calling_list", status: "applied", retryable: false, appliedEntityId: list.entityId },
      { batchId, runId, proposalKey: "contact:CONTACT-1", targetEntityType: "contact", status: "applied", retryable: false, appliedEntityId: personId },
    ]);
    const member = operation({ proposalKey: "calling_list_member:GROUP-1:CONTACT-1", targetEntityType: "calling_list_member", sourceRecordKeys: ["group_contact:GROUP-1:CONTACT-1"], dependencyProposalKeys: ["calling_list:GROUP-1", "contact:CONTACT-1"] });
    const applied = await Promise.all([repository.applyMembership(member), repository.applyMembership(member)]);
    expect(applied).toEqual(expect.arrayContaining([expect.objectContaining({ changed: true }), expect.objectContaining({ changed: false })]));
    expect(await database.select().from(crmSchema.callingListMemberships).where(and(eq(crmSchema.callingListMemberships.callingListId, list.entityId), eq(crmSchema.callingListMemberships.contactId, personId)))).toMatchObject([{ active: true, source: "act_migration" }]);

    await database.update(crmSchema.callingListMemberships).set({ active: false, source: "manual" }).where(and(eq(crmSchema.callingListMemberships.callingListId, list.entityId), eq(crmSchema.callingListMemberships.contactId, personId)));
    await expect(repository.applyMembership(member)).resolves.toMatchObject({ changed: false });
    expect(await database.select({ active: crmSchema.callingListMemberships.active, source: crmSchema.callingListMemberships.source }).from(crmSchema.callingListMemberships).where(eq(crmSchema.callingListMemberships.callingListId, list.entityId))).toEqual([{ active: false, source: "manual" }]);

    const stablePersonId = "44444444-4444-4444-8444-444444444444";
    await database.insert(crmSchema.contacts).values({ id: stablePersonId, firstName: "Stable", lastName: "Person" });
    await database.insert(crmSchema.actExternalLinks).values({ entityType: "contact", sourceEntityType: "contact", entityId: stablePersonId, actRecordId: "CONTACT-2", isPrimary: true, syncMode: "two_way" });
    await database.insert(crmSchema.actMigrationRecords).values({ runId, streamType: "group_contact", sourceKey: "group_contact:GROUP-1:CONTACT-2", sourceId: "GROUP-1", targetSourceId: "CONTACT-2", rawSnapshot: {}, normalizedSnapshot: { sourceId: "GROUP-1", targetSourceId: "CONTACT-2", membershipSemantics: "unknown" }, fingerprint: "stable-membership" });
    const stableMember = operation({ proposalKey: "calling_list_member:GROUP-1:CONTACT-2", targetEntityType: "calling_list_member", sourceRecordKeys: ["group_contact:GROUP-1:CONTACT-2"], dependencyProposalKeys: ["calling_list:GROUP-1"] });
    await expect(repository.applyMembership(stableMember)).resolves.toMatchObject({ changed: true });
    expect(await database.select().from(crmSchema.callingListMemberships).where(and(eq(crmSchema.callingListMemberships.callingListId, list.entityId), eq(crmSchema.callingListMemberships.contactId, stablePersonId)))).toMatchObject([{ active: true, source: "act_migration" }]);
  });

  postgresTest("requires a confirmed static list operation and rejects materialized dynamic memberships", async () => {
    const dynamic = await lists.createOrVerifyDynamicList({ name: "Colorado", sourceId: "DYNAMIC-2", runId, filterDefinition: { version: 1, entity: "person", where: { op: "predicate", field: "person.region", operator: "eq", value: "CO" } } });
    await confirmedListProposal(database, "calling_list:DYNAMIC-2");
    await database.insert(crmSchema.actMigrationApplyOperations).values([
      { batchId, runId, proposalKey: "calling_list:DYNAMIC-2", targetEntityType: "calling_list", status: "applied", retryable: false, appliedEntityId: dynamic.entityId },
      { batchId, runId, proposalKey: "contact:CONTACT-1", targetEntityType: "contact", status: "applied", retryable: false, appliedEntityId: personId },
    ]);
    const member = operation({ proposalKey: "calling_list_member:DYNAMIC-2:CONTACT-1", targetEntityType: "calling_list_member", sourceRecordKeys: ["group_contact:GROUP-1:CONTACT-1"], dependencyProposalKeys: ["calling_list:DYNAMIC-2", "contact:CONTACT-1"] });
    await expect(repository.applyMembership(member)).rejects.toThrow("static");
  });
});
