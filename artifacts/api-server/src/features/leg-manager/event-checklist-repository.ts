import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  bookings,
  eventChecklistAttachments,
  eventChecklistItemResults,
  eventChecklistRuns,
  eventChecklistTemplateItems,
  eventChecklistTemplates,
} from "@/db/schema";
import type {
  ChecklistFollowUpSyncState,
  ChecklistPhase,
  ChecklistResult,
} from "@workspace/db/event-checklist-schema";
import type { EventChecklistView } from "./event-checklist-types";

type Database = NodePgDatabase<typeof schema>;

type AssignedResource = {
  id: string;
  name: string;
  checklistTags: string[];
};

type AssignedResourceRow = {
  id: string;
  name: string;
  checklist_tags: string[] | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

export class EventChecklistRepository {
  constructor(readonly database: Database) {}

  async bookingBelongsToLeg(bookingId: string, legId: string) {
    return Boolean(
      (
        await this.database
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.id, bookingId), eq(bookings.travelLegId, legId)))
          .limit(1)
      )[0],
    );
  }

  async activeTemplate(phase: ChecklistPhase) {
    return (
      (
        await this.database
          .select()
          .from(eventChecklistTemplates)
          .where(
            and(
              eq(eventChecklistTemplates.phase, phase),
              eq(eventChecklistTemplates.active, true),
            ),
          )
          .orderBy(desc(eventChecklistTemplates.version))
          .limit(1)
      )[0] ?? null
    );
  }

  listTemplateItems(templateId: string) {
    return this.database
      .select()
      .from(eventChecklistTemplateItems)
      .where(
        and(
          eq(eventChecklistTemplateItems.templateId, templateId),
          eq(eventChecklistTemplateItems.active, true),
        ),
      )
      .orderBy(asc(eventChecklistTemplateItems.sortOrder));
  }

  async assignedResources(bookingId: string): Promise<AssignedResource[]> {
    const rows = rowsOf<AssignedResourceRow>(
      await this.database.execute(sql`
        select
          r.id,
          r.name,
          coalesce(r.checklist_tags, array[]::text[]) as checklist_tags
        from booking_resource_assignments bra
        join resources r on r.id = bra.resource_id
        where bra.booking_id = ${bookingId}::uuid
          and r.status <> 'archived'
        order by r.name, r.id
      `),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      checklistTags: row.checklist_tags ?? [],
    }));
  }

  async getRun(bookingId: string, legId: string, phase: ChecklistPhase) {
    return (
      (
        await this.database
          .select()
          .from(eventChecklistRuns)
          .where(
            and(
              eq(eventChecklistRuns.bookingId, bookingId),
              eq(eventChecklistRuns.legId, legId),
              eq(eventChecklistRuns.phase, phase),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async createRun(input: {
    bookingId: string;
    legId: string;
    phase: ChecklistPhase;
    templateId: string;
    clientMutationId: string;
    startedAt: Date;
  }) {
    await this.database
      .insert(eventChecklistRuns)
      .values({
        bookingId: input.bookingId,
        legId: input.legId,
        phase: input.phase,
        templateId: input.templateId,
        clientMutationId: input.clientMutationId,
        startedAt: input.startedAt,
        state: "in_progress",
      })
      .onConflictDoNothing();
    return this.getRun(input.bookingId, input.legId, input.phase);
  }

  async createGeneratedResults(input: {
    runId: string;
    items: Array<{
      templateItemId: string;
      itemCode: string;
      label: string;
      resourceId: string | null;
      resourceName: string | null;
    }>;
  }) {
    for (const item of input.items) {
      await this.database
        .insert(eventChecklistItemResults)
        .values({
          runId: input.runId,
          templateItemId: item.templateItemId,
          resourceId: item.resourceId,
          itemCodeSnapshot: item.itemCode,
          itemLabelSnapshot: item.label,
          resourceNameSnapshot: item.resourceName,
          result: null,
          note: null,
          followUpSyncState: "not_required",
          clientMutationId: randomUUID(),
        })
        .onConflictDoNothing();
    }
  }

  async resultForLeg(resultId: string, legId: string) {
    return (
      (
        await this.database
          .select({
            result: eventChecklistItemResults,
            run: eventChecklistRuns,
            item: eventChecklistTemplateItems,
          })
          .from(eventChecklistItemResults)
          .innerJoin(
            eventChecklistRuns,
            eq(eventChecklistRuns.id, eventChecklistItemResults.runId),
          )
          .innerJoin(
            eventChecklistTemplateItems,
            eq(
              eventChecklistTemplateItems.id,
              eventChecklistItemResults.templateItemId,
            ),
          )
          .where(
            and(
              eq(eventChecklistItemResults.id, resultId),
              eq(eventChecklistRuns.legId, legId),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async updateResult(input: {
    resultId: string;
    result: ChecklistResult;
    note: string | null;
    followUpSyncState: ChecklistFollowUpSyncState;
    clientMutationId: string;
  }) {
    return (
      (
        await this.database
          .update(eventChecklistItemResults)
          .set({
            result: input.result,
            note: input.note?.trim() || null,
            followUpSyncState: input.followUpSyncState,
            clientMutationId: input.clientMutationId,
            updatedAt: new Date(),
          })
          .where(eq(eventChecklistItemResults.id, input.resultId))
          .returning()
      )[0] ?? null
    );
  }

  async setFollowUpSyncState(
    resultId: string,
    state: ChecklistFollowUpSyncState,
  ) {
    await this.database
      .update(eventChecklistItemResults)
      .set({ followUpSyncState: state, updatedAt: new Date() })
      .where(eq(eventChecklistItemResults.id, resultId));
  }

  async completeRun(runId: string) {
    const now = new Date();
    return (
      (
        await this.database
          .update(eventChecklistRuns)
          .set({ state: "completed", completedAt: now, unableReason: null, updatedAt: now })
          .where(eq(eventChecklistRuns.id, runId))
          .returning()
      )[0] ?? null
    );
  }

  async markUnable(runId: string, reason: string) {
    const now = new Date();
    return (
      (
        await this.database
          .update(eventChecklistRuns)
          .set({
            state: "unable_to_complete",
            unableReason: reason.trim(),
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(eventChecklistRuns.id, runId))
          .returning()
      )[0] ?? null
    );
  }

  async view(runId: string): Promise<EventChecklistView | null> {
    const run = (
      await this.database
        .select()
        .from(eventChecklistRuns)
        .where(eq(eventChecklistRuns.id, runId))
        .limit(1)
    )[0];
    if (!run) return null;

    const rows = await this.database
      .select({
        result: eventChecklistItemResults,
        item: eventChecklistTemplateItems,
      })
      .from(eventChecklistItemResults)
      .innerJoin(
        eventChecklistTemplateItems,
        eq(eventChecklistTemplateItems.id, eventChecklistItemResults.templateItemId),
      )
      .where(eq(eventChecklistItemResults.runId, runId))
      .orderBy(
        asc(eventChecklistTemplateItems.sortOrder),
        asc(eventChecklistItemResults.resourceNameSnapshot),
      );

    const resultIds = rows.map((row) => row.result.id);
    const attachments = resultIds.length
      ? await this.database
          .select({ resultId: eventChecklistAttachments.resultId })
          .from(eventChecklistAttachments)
          .where(inArray(eventChecklistAttachments.resultId, resultIds))
      : [];
    const photoCounts = new Map<string, number>();
    for (const attachment of attachments) {
      photoCounts.set(
        attachment.resultId,
        (photoCounts.get(attachment.resultId) ?? 0) + 1,
      );
    }

    return {
      id: run.id,
      bookingId: run.bookingId,
      legId: run.legId,
      phase: run.phase,
      state: run.state,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      unableReason: run.unableReason,
      items: rows.map(({ result, item }) => ({
        resultId: result.id,
        itemCode: result.itemCodeSnapshot,
        label: result.itemLabelSnapshot,
        scope: item.scope,
        resourceId: result.resourceId,
        resourceName: result.resourceNameSnapshot,
        safetyCritical: item.safetyCritical,
        result: result.result,
        note: result.note,
        photoCount: photoCounts.get(result.id) ?? 0,
        followUpSyncState: result.followUpSyncState,
      })),
    };
  }
}
