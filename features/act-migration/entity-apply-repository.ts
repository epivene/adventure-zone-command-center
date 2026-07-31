import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  actMigrationApplyBatches,
  actMigrationRecords,
  auditEntries,
  contacts,
  organizations,
} from "@/db/schema";
import type { MigrationApplyOperation } from "@/features/act-migration/apply-repository";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";

type DrizzleDatabase = typeof database;
type Transaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];
type Values = Record<string, unknown>;

export type MigrationEntityApplyResult = { entityId: string; changed: boolean };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function changedFields<T extends Record<string, unknown>>(current: T, next: Partial<T>) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => current[key] !== value)) as Partial<T>;
}

function contactValues(source: Values) {
  const phone = text(source.phone);
  const firstName = text(source.firstName);
  const lastName = text(source.lastName);
  if (!firstName && !lastName) throw new Error("Act migration Contact has no person name.");
  return {
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    email: text(source.email),
    phone,
    normalizedPhone: phone ? normalizeNorthAmericanPhone(phone) : null,
    jobTitle: text(source.jobTitle),
    address1: text(source.address1),
    address2: text(source.address2),
    city: text(source.city),
    region: text(source.region),
    postalCode: text(source.postalCode),
  };
}

function companyValues(source: Values, folded: readonly Values[]) {
  const merged = { ...source } as Values;
  for (const contact of folded) {
    for (const field of ["phone", "address1", "address2", "city", "region", "postalCode"] as const) {
      if (text(merged[field]) === null) merged[field] = contact[field];
    }
  }
  const phone = text(merged.phone);
  const name = text(merged.displayName) ?? text(merged.companyName);
  if (!name) throw new Error("Act migration Organization has no name.");
  return {
    name,
    actIndustry: text(merged.industry),
    phone,
    normalizedPhone: phone ? normalizeNorthAmericanPhone(phone) : null,
    address1: text(merged.address1),
    address2: text(merged.address2),
    city: text(merged.city),
    region: text(merged.region),
    postalCode: text(merged.postalCode),
    website: text(merged.website),
  };
}

function targetId(operation: MigrationApplyOperation) {
  const proposal = operation.proposal;
  if (proposal.decision === "link_existing") {
    if (!proposal.chosenLocalEntityId) throw new Error("Act migration link-existing decision has no local entity.");
    return proposal.chosenLocalEntityId;
  }
  if (proposal.state === "change" || proposal.state === "matched_unchanged") {
    if (!proposal.proposedLocalId) throw new Error("Act migration change has no proposed local entity.");
    return proposal.proposedLocalId;
  }
  return null;
}

export class MigrationEntityApplyRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  applyOrganization(operation: MigrationApplyOperation): Promise<MigrationEntityApplyResult> {
    if (operation.targetEntityType !== "organization") throw new Error("Expected an Organization apply operation.");
    return this.database.transaction((transaction) => this.applyOrganizationIn(transaction, operation));
  }

  applyContact(operation: MigrationApplyOperation): Promise<MigrationEntityApplyResult> {
    if (operation.targetEntityType !== "contact") throw new Error("Expected a Contact apply operation.");
    return this.database.transaction((transaction) => this.applyContactIn(transaction, operation));
  }

  private async lockOperation(transaction: Transaction, operation: MigrationApplyOperation) {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${operation.runId}:${operation.proposalKey}`}))`);
    const records = await transaction.select().from(actMigrationRecords).where(and(
      eq(actMigrationRecords.runId, operation.runId),
      inArray(actMigrationRecords.sourceKey, [...operation.proposal.sourceRecordKeys]),
    )).orderBy(asc(actMigrationRecords.sourceKey)).for("update");
    if (records.length !== operation.proposal.sourceRecordKeys.length ||
      new Set(records.map(({ sourceKey }) => sourceKey)).size !== operation.proposal.sourceRecordKeys.length) {
      throw new Error("Act migration staged source records are incomplete.");
    }
    return records;
  }

  private async actor(transaction: Transaction, operation: MigrationApplyOperation) {
    const [batch] = await transaction.select({ requestedBy: actMigrationApplyBatches.requestedBy })
      .from(actMigrationApplyBatches).where(eq(actMigrationApplyBatches.id, operation.batchId)).limit(1).for("key share");
    return batch?.requestedBy ?? "act-migration";
  }

  private async audit(transaction: Transaction, input: {
    entityType: "organization" | "contact"; entityId: string; operation: MigrationApplyOperation;
    actor: string; changedFields: string[]; sourceIds: string[];
  }) {
    await recordAuditEntry(transaction, {
      entityType: input.entityType,
      entityId: input.entityId,
      action: "act_migration_applied",
      before: null,
      after: {
        runId: input.operation.runId,
        proposalKey: input.operation.proposalKey,
        actor: input.actor,
        changedFields: input.changedFields,
        sourceIds: input.sourceIds,
      },
    });
  }

  private async ensureLinks(transaction: Transaction, input: {
    entityType: "organization" | "contact"; entityId: string; runId: string;
    records: readonly typeof actMigrationRecords.$inferSelect[]; primarySourceId: string | null;
  }) {
    const sourceType = input.entityType === "organization" ? "company" : "contact";
    const sources = input.records.filter((record) => record.streamType === sourceType && record.sourceId !== null)
      .map((record) => record.sourceId!);
    if (sources.length === 0) return { changed: false, primaryId: null as string | null };
    const primaryId = input.entityType === "contact"
      ? (input.primarySourceId ?? sources[0]!)
      : sources[0]!;
    if (!sources.includes(primaryId)) throw new Error("Act migration primary source is not staged.");
    const links = await transaction.select().from(actExternalLinks).where(or(
      inArray(actExternalLinks.entityId, [input.entityId]),
      and(eq(actExternalLinks.sourceEntityType, sourceType), inArray(actExternalLinks.actRecordId, sources)),
    )).orderBy(asc(actExternalLinks.sourceEntityType), asc(actExternalLinks.actRecordId), asc(actExternalLinks.entityId)).for("update");
    let changed = false;
    // A reviewed primary replaces, rather than coexists with, any prior
    // primary Contact identity for this person. The partial unique index
    // makes this transition explicit and keeps the legacy mirror coherent.
    if (input.entityType === "contact") {
      for (const link of links) {
        if (link.entityId === input.entityId && link.sourceEntityType === "contact" && link.isPrimary && link.actRecordId !== primaryId) {
          await transaction.update(actExternalLinks).set({ isPrimary: false, syncMode: "pull_only", updatedAt: new Date() }).where(eq(actExternalLinks.id, link.id));
          changed = true;
        }
      }
    }
    for (const sourceId of sources) {
      const canonical = sourceId === primaryId;
      const matching = links.find((link) => link.sourceEntityType === sourceType && link.actRecordId === sourceId);
      if (matching && matching.entityId !== input.entityId) throw new Error("Act migration source is already linked to another local entity.");
      const desired = input.entityType === "contact"
        ? { isPrimary: canonical, syncMode: canonical ? "two_way" : "pull_only" }
        : { isPrimary: false, syncMode: "pull_only" };
      if (!matching) {
        await transaction.insert(actExternalLinks).values({ entityType: input.entityType, sourceEntityType: sourceType, entityId: input.entityId, actRecordId: sourceId, migrationRunId: input.runId, ...desired });
        changed = true;
      } else if (matching.isPrimary !== desired.isPrimary || matching.syncMode !== desired.syncMode || matching.migrationRunId !== input.runId) {
        await transaction.update(actExternalLinks).set({ ...desired, migrationRunId: input.runId, updatedAt: new Date() }).where(eq(actExternalLinks.id, matching.id));
        changed = true;
      }
    }
    return { changed, primaryId };
  }

  private async applyOrganizationIn(transaction: Transaction, operation: MigrationApplyOperation): Promise<MigrationEntityApplyResult> {
    const records = await this.lockOperation(transaction, operation);
    const companies = records.filter((record) => record.streamType === "company");
    const company = companies[0]?.normalizedSnapshot as Values | undefined;
    const folded = records.filter((record) => record.streamType === "contact").map((record) => record.normalizedSnapshot as Values);
    const values = companyValues(company ?? (folded[0] ?? {}), company ? folded : folded.slice(1));
    const existingId = targetId(operation);
    let entity: typeof organizations.$inferSelect;
    let mappedChanged = false;
    let mappedFields: string[] = [];
    if (existingId) {
      const [current] = await transaction.select().from(organizations).where(eq(organizations.id, existingId)).limit(1).for("update");
      if (!current) throw new Error("Act migration Organization target is missing.");
      const changed = changedFields(current, values);
      if (Object.keys(changed).length) entity = (await transaction.update(organizations).set({ ...changed, updatedAt: new Date() }).where(eq(organizations.id, current.id)).returning())[0]!;
      else entity = current;
      mappedChanged = Object.keys(changed).length > 0;
      mappedFields = Object.keys(changed);
    } else {
      entity = (await transaction.insert(organizations).values(values).returning())[0]!;
      mappedChanged = true;
      mappedFields = Object.keys(values);
    }
    const links = await this.ensureLinks(transaction, { entityType: "organization", entityId: entity.id, runId: operation.runId, records, primarySourceId: null });
    const primaryChanged = links.primaryId !== null && entity.actRecordId !== links.primaryId;
    if (primaryChanged) entity = (await transaction.update(organizations).set({ actRecordId: links.primaryId, updatedAt: new Date() }).where(eq(organizations.id, entity.id)).returning())[0]!;
    const changed = mappedChanged || links.changed || primaryChanged;
    if (changed) await this.audit(transaction, { entityType: "organization", entityId: entity.id, operation, actor: await this.actor(transaction, operation), changedFields: [...mappedFields, ...(links.changed ? ["externalLinks"] : []), ...(primaryChanged ? ["actRecordId"] : [])].filter((value, index, all) => all.indexOf(value) === index), sourceIds: records.flatMap((record) => record.sourceId ? [record.sourceId] : []) });
    return { entityId: entity.id, changed };
  }

  private async applyContactIn(transaction: Transaction, operation: MigrationApplyOperation): Promise<MigrationEntityApplyResult> {
    const records = await this.lockOperation(transaction, operation);
    const primary = records.find((record) => record.streamType === "contact" && record.sourceId === operation.proposal.primarySourceId) ?? records.find((record) => record.streamType === "contact");
    if (!primary) throw new Error("Act migration Contact has no staged Contact record.");
    const values = contactValues(primary.normalizedSnapshot as Values);
    const existingId = targetId(operation);
    let entity: typeof contacts.$inferSelect;
    let mappedChanged = false;
    let mappedFields: string[] = [];
    if (existingId) {
      const [current] = await transaction.select().from(contacts).where(eq(contacts.id, existingId)).limit(1).for("update");
      if (!current) throw new Error("Act migration Contact target is missing.");
      const changed = changedFields(current, values);
      if (Object.keys(changed).length) entity = (await transaction.update(contacts).set({ ...changed, updatedAt: new Date() }).where(eq(contacts.id, current.id)).returning())[0]!;
      else entity = current;
      mappedChanged = Object.keys(changed).length > 0;
      mappedFields = Object.keys(changed);
    } else {
      entity = (await transaction.insert(contacts).values(values).returning())[0]!;
      mappedChanged = true;
      mappedFields = Object.keys(values);
    }
    const links = await this.ensureLinks(transaction, { entityType: "contact", entityId: entity.id, runId: operation.runId, records, primarySourceId: operation.proposal.primarySourceId });
    const primaryChanged = links.primaryId !== null && entity.actRecordId !== links.primaryId;
    if (primaryChanged) entity = (await transaction.update(contacts).set({ actRecordId: links.primaryId, updatedAt: new Date() }).where(eq(contacts.id, entity.id)).returning())[0]!;
    const changed = mappedChanged || links.changed || primaryChanged;
    if (changed) await this.audit(transaction, { entityType: "contact", entityId: entity.id, operation, actor: await this.actor(transaction, operation), changedFields: [...mappedFields, ...(links.changed ? ["externalLinks"] : []), ...(primaryChanged ? ["actRecordId"] : [])].filter((value, index, all) => all.indexOf(value) === index), sourceIds: records.flatMap((record) => record.sourceId ? [record.sourceId] : []) });
    return { entityId: entity.id, changed };
  }
}
