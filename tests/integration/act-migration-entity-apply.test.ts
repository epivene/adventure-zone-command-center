import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import { MigrationEntityApplyRepository } from "@/features/act-migration/entity-apply-repository";
import type { MigrationApplyOperation } from "@/features/act-migration/apply-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const runId = "11111111-1111-4111-8111-111111111111";

function testSchemaName() { return `act_entity_apply_${randomUUID().replaceAll("-", "_")}`; }
async function statements(file: string, schema: string) {
  return (await readFile(path.join(migrationDirectory, file), "utf8"))
    .replaceAll('"public".', `"${schema}".`).split("--> statement-breakpoint")
    .map((value) => value.trim()).filter(Boolean);
}

function operation(input: Partial<MigrationApplyOperation> & { proposalKey: string }): MigrationApplyOperation {
  return {
    id: "33333333-3333-4333-8333-333333333333", batchId: "44444444-4444-4444-8444-444444444444", runId,
    targetEntityType: "contact", dependencyProposalKeys: [], status: "leased", attemptCount: 1,
    leaseOwner: "worker", leaseExpiresAt: null, appliedEntityId: null, errorCode: null, retryable: true,
    proposal: {
      proposalKey: input.proposalKey, state: "new", reviewState: "decided", targetEntityType: "contact",
      sourceRecordKeys: ["contact:primary", "contact:alias"], candidateLocalIds: [], proposedLocalId: null,
      proposedPrimarySourceId: null, issueCode: null, dependencyProposalKeys: [], matchReason: "fixture",
      displaySnapshot: { displayName: "DISPLAY SNAPSHOT MUST NOT WRITE" }, decision: "approve_proposed",
      chosenLocalEntityId: null, primarySourceId: "primary", ...input.proposal,
    },
    ...input,
  } as MigrationApplyOperation;
}

describe("MigrationEntityApplyRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let database: ReturnType<typeof drizzle<typeof crmSchema>>;
  let repository: MigrationEntityApplyRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    const schema = testSchemaName();
    schemaName = schema;
    const setup = postgres(databaseUrl, { max: 1, connection: { search_path: `${schema},public` } });
    try {
      await setup.unsafe(`CREATE SCHEMA "${schema}"`);
      const journal = JSON.parse(await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
      for (const entry of journal.entries) for (const statement of await statements(`${entry.tag}.sql`, schema)) await setup.unsafe(statement);
    } finally { await setup.end({ timeout: 5 }); }
    sql = postgres(databaseUrl, { max: 4, connection: { search_path: `${schema},public` } });
    database = drizzle({ client: sql, schema: crmSchema });
    repository = new MigrationEntityApplyRepository(database);
    await database.insert(crmSchema.actMigrationRuns).values({ id: runId, requestKey: "22222222-2222-4222-8222-222222222222", sourceDatabaseKey: "test", requestedBy: "owner", status: "applying" });
  });
  afterEach(async () => { if (!sql) return; try { await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); } finally { await sql.end({ timeout: 5 }); sql = undefined; } });

  postgresTest("creates a contact only from staged normalized data, links aliases canonically, and suppresses semantic retries", async () => {
    await database.insert(crmSchema.actMigrationRecords).values([
      { runId, streamType: "contact", sourceKey: "contact:primary", sourceId: "primary", rawSnapshot: { secret: "never write" }, normalizedSnapshot: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "(303) 555-0199", jobTitle: "Engineer", address1: "1 Main", address2: null, city: "Denver", region: "CO", postalCode: "80202" }, fingerprint: "one" },
      { runId, streamType: "contact", sourceKey: "contact:alias", sourceId: "alias", rawSnapshot: { secret: "also never write" }, normalizedSnapshot: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "(303) 555-0199", jobTitle: "Engineer", address1: "1 Main", address2: null, city: "Denver", region: "CO", postalCode: "80202" }, fingerprint: "two" },
    ]);
    const applied = await repository.applyContact(operation({ proposalKey: "contact:ada" }));
    expect(applied.changed).toBe(true);
    expect(await database.select().from(crmSchema.contacts).where(eq(crmSchema.contacts.id, applied.entityId))).toMatchObject([{ firstName: "Ada", lastName: "Lovelace", actRecordId: "primary", normalizedPhone: "+13035550199" }]);
    expect(await database.select().from(crmSchema.actExternalLinks).where(eq(crmSchema.actExternalLinks.entityId, applied.entityId))).toEqual(expect.arrayContaining([
      expect.objectContaining({ actRecordId: "primary", isPrimary: true, syncMode: "two_way" }),
      expect.objectContaining({ actRecordId: "alias", isPrimary: false, syncMode: "pull_only" }),
    ]));
    expect(await repository.applyContact(operation({ proposalKey: "contact:ada" }))).toEqual({ entityId: applied.entityId, changed: false });
    expect(await database.select().from(crmSchema.auditEntries)).toHaveLength(1);
  });

  postgresTest("links an approved existing organization without overwriting operational fields", async () => {
    const organizationId = "55555555-5555-4555-8555-555555555555";
    await database.insert(crmSchema.organizations).values({ id: organizationId, name: "Local name", lastResort: true, lastResortReason: "manual policy" });
    await database.insert(crmSchema.actMigrationRecords).values({ runId, streamType: "company", sourceKey: "company:acme", sourceId: "acme", rawSnapshot: {}, normalizedSnapshot: { displayName: "ACT Name", phone: "303-555-0100", industry: "Events", address1: null, address2: null, city: null, region: null, postalCode: null, website: null }, fingerprint: "company" });
    const result = await repository.applyOrganization(operation({ proposalKey: "organization:acme", targetEntityType: "organization", proposal: { proposalKey: "organization:acme", state: "possible_duplicate", reviewState: "decided", targetEntityType: "organization", sourceRecordKeys: ["company:acme"], candidateLocalIds: [organizationId], proposedLocalId: organizationId, proposedPrimarySourceId: null, issueCode: null, dependencyProposalKeys: [], matchReason: "fixture", displaySnapshot: {}, decision: "link_existing", chosenLocalEntityId: organizationId, primarySourceId: null } }));
    expect(result).toEqual({ entityId: organizationId, changed: true });
    expect(await database.select().from(crmSchema.organizations).where(eq(crmSchema.organizations.id, organizationId))).toMatchObject([{ name: "ACT Name", lastResort: true, lastResortReason: "manual policy", actRecordId: "acme" }]);
  });

  postgresTest("creates one canonical place for duplicate sources, keeps every source link, and is idempotent", async () => {
    await database.insert(crmSchema.actMigrationRecords).values([
      { runId, streamType: "company", sourceKey: "company:ACT-1", sourceId: "ACT-1", rawSnapshot: {}, normalizedSnapshot: { displayName: "Example Place", phone: null, industry: null, address1: "1 Main", address2: null, city: "Denver", region: "CO", postalCode: "80202", website: null }, fingerprint: "company-one" },
      { runId, streamType: "company", sourceKey: "company:ACT-2", sourceId: "ACT-2", rawSnapshot: {}, normalizedSnapshot: { displayName: "Example Place", phone: null, industry: null, address1: "1 Main", address2: null, city: "Denver", region: "CO", postalCode: "80202", website: null }, fingerprint: "company-two" },
    ]);
    const value = operation({
      proposalKey: "organization:company:ACT-1",
      targetEntityType: "organization",
      proposal: {
        proposalKey: "organization:company:ACT-1", state: "new", reviewState: "decided", targetEntityType: "organization",
        sourceRecordKeys: ["company:ACT-1", "company:ACT-2"], candidateLocalIds: [], proposedLocalId: null, proposedPrimarySourceId: null,
        duplicateGroupKey: '["example place","1 main denver co"]', duplicateSourceIds: ["ACT-1", "ACT-2"], issueCode: null,
        dependencyProposalKeys: [], matchReason: "exact_normalized_place_duplicate_group", displaySnapshot: {}, decision: "approve_proposed",
        chosenLocalEntityId: null, primarySourceId: null,
      },
    });

    const first = await repository.applyOrganization(value);
    await expect(repository.applyOrganization(value)).resolves.toEqual({ entityId: first.entityId, changed: false });

    expect(await database.select().from(crmSchema.organizations)).toHaveLength(1);
    expect(await database.select({ actRecordId: crmSchema.actExternalLinks.actRecordId })
      .from(crmSchema.actExternalLinks)
      .where(eq(crmSchema.actExternalLinks.entityId, first.entityId)))
      .toEqual([{ actRecordId: "ACT-1" }, { actRecordId: "ACT-2" }]);
  });
});
