import { and, eq, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  callingListMemberships,
  callingLists,
} from "@/db/schema";
import {
  parseCallingListFilterV1,
  type CallingListFilterV1,
} from "@/features/calling-lists/calling-list-filter";

type DrizzleDatabase = typeof database;
export type CallingListTransaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];

export type CallingListMutationResult = { entityId: string; changed: boolean; wasCreated: boolean };

export type StaticCallingListInput = {
  name: string;
  sourceId: string;
  runId: string;
};

export type DynamicCallingListInput = StaticCallingListInput & {
  filterDefinition: unknown;
};

function requiredText(value: string, label: string) {
  const text = value.trim();
  if (!text) throw new Error(`Calling list ${label} is required.`);
  return text;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class CallingListRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  createOrVerifyStaticList(input: StaticCallingListInput): Promise<CallingListMutationResult> {
    return this.database.transaction((transaction) => this.createOrVerifyStaticListIn(transaction, input));
  }

  createOrVerifyDynamicList(input: DynamicCallingListInput): Promise<CallingListMutationResult> {
    return this.database.transaction((transaction) => this.createOrVerifyDynamicListIn(transaction, input));
  }

  createOrReactivateMembership(input: { callingListId: string; contactId: string }): Promise<CallingListMutationResult> {
    return this.database.transaction((transaction) => this.createOrReactivateMembershipIn(transaction, input));
  }

  async createOrVerifyStaticListIn(transaction: CallingListTransaction, input: StaticCallingListInput): Promise<CallingListMutationResult> {
    return this.createOrVerifyListIn(transaction, {
      ...input,
      name: requiredText(input.name, "name"),
      sourceId: requiredText(input.sourceId, "source ID"),
      kind: "static",
      filterDefinition: null,
      filterVersion: null,
    });
  }

  async createOrVerifyDynamicListIn(transaction: CallingListTransaction, input: DynamicCallingListInput): Promise<CallingListMutationResult> {
    const filterDefinition = parseCallingListFilterV1(input.filterDefinition);
    return this.createOrVerifyListIn(transaction, {
      ...input,
      name: requiredText(input.name, "name"),
      sourceId: requiredText(input.sourceId, "source ID"),
      kind: "dynamic",
      filterDefinition,
      filterVersion: filterDefinition.version,
    });
  }

  async createOrReactivateMembershipIn(transaction: CallingListTransaction, input: { callingListId: string; contactId: string }): Promise<CallingListMutationResult> {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`calling-list-membership:${input.callingListId}:${input.contactId}`}))`);
    const [list] = await transaction.select({ id: callingLists.id, kind: callingLists.kind }).from(callingLists)
      .where(eq(callingLists.id, input.callingListId)).limit(1).for("update");
    if (!list) throw new Error("Calling list dependency is missing.");
    if (list.kind !== "static") throw new Error("Dynamic calling lists cannot have materialized memberships.");
    const [membership] = await transaction.select().from(callingListMemberships).where(and(
      eq(callingListMemberships.callingListId, input.callingListId),
      eq(callingListMemberships.contactId, input.contactId),
    )).limit(1).for("update");
    if (!membership) {
      const [created] = await transaction.insert(callingListMemberships).values({
        callingListId: input.callingListId, contactId: input.contactId, source: "act_migration", active: true,
      }).returning();
      return { entityId: created!.id, changed: true, wasCreated: true };
    }
    if (membership.source === "manual") return { entityId: membership.id, changed: false, wasCreated: false };
    if (!membership.active) {
      const [reactivated] = await transaction.update(callingListMemberships).set({ active: true, updatedAt: new Date() })
        .where(eq(callingListMemberships.id, membership.id)).returning();
      return { entityId: reactivated!.id, changed: true, wasCreated: false };
    }
    return { entityId: membership.id, changed: false, wasCreated: false };
  }

  private async createOrVerifyListIn(transaction: CallingListTransaction, input: StaticCallingListInput & {
    kind: "static" | "dynamic";
    filterVersion: number | null;
    filterDefinition: CallingListFilterV1 | null;
  }): Promise<CallingListMutationResult> {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`calling-list-source:group:${input.sourceId}`}))`);
    const [link] = await transaction.select().from(actExternalLinks).where(and(
      eq(actExternalLinks.sourceEntityType, "group"),
      eq(actExternalLinks.actRecordId, input.sourceId),
    )).limit(1).for("update");
    if (link && link.entityType !== "calling_list") throw new Error("Act Group is linked to a different entity type.");
    if (link && link.migrationRunId === null) throw new Error("Act Group link points to a manual calling list.");
    const listId = link?.entityId;
    let list: typeof callingLists.$inferSelect;
    let changed = false;
    if (listId) {
      const [existing] = await transaction.select().from(callingLists).where(eq(callingLists.id, listId)).limit(1).for("update");
      if (!existing) throw new Error("Act Group link target is missing.");
      list = existing;
      if (list.kind !== input.kind) throw new Error("Calling list kind conflicts with the existing Act Group link.");
      if (canonicalJson(list.filterDefinition) !== canonicalJson(input.filterDefinition) || list.filterVersion !== input.filterVersion) {
        throw new Error("Calling list filter conflicts with the existing Act Group link.");
      }
    } else {
      list = (await transaction.insert(callingLists).values({
        name: input.name, kind: input.kind, filterVersion: input.filterVersion, filterDefinition: input.filterDefinition,
      }).returning())[0]!;
      await transaction.insert(actExternalLinks).values({
        entityType: "calling_list", sourceEntityType: "group", entityId: list.id, actRecordId: input.sourceId,
        isPrimary: false, syncMode: "pull_only", migrationRunId: input.runId,
      });
      changed = true;
    }
    return { entityId: list.id, changed, wasCreated: !listId };
  }
}
