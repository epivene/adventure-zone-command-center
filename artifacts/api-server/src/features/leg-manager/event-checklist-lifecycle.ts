import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  eventChecklistItemResults,
  eventChecklistOverrides,
  eventChecklistRuns,
  eventChecklistTemplateItems,
  resourceConditionIssues,
} from "@/db/schema";
import type {
  ChecklistOverrideAction,
  ChecklistPhase,
  ChecklistRunState,
} from "@workspace/db/event-checklist-schema";

type Database = NodePgDatabase<typeof schema>;
export type ChecklistLifecycleState = ChecklistRunState | "not_started";

export type ChecklistLifecycleProjection = {
  preEventChecklistState: ChecklistLifecycleState;
  postEventChecklistState: ChecklistLifecycleState;
  readyToOperate: boolean;
  hasSiteWideUnsafeIssue: boolean;
  hasChecklistFollowUpNeedsAttention: boolean;
};

export class EventChecklistLifecycleService {
  constructor(private readonly database: Database) {}

  private async getRun(bookingId: string, legId: string, phase: ChecklistPhase) {
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

  private async hasOverride(runId: string, action: ChecklistOverrideAction) {
    return Boolean(
      (
        await this.database
          .select({ id: eventChecklistOverrides.id })
          .from(eventChecklistOverrides)
          .where(
            and(
              eq(eventChecklistOverrides.runId, runId),
              eq(eventChecklistOverrides.action, action),
            ),
          )
          .limit(1)
      )[0],
    );
  }

  private async hasFollowUpNeedsAttention(runId: string) {
    return Boolean(
      (
        await this.database
          .select({ id: eventChecklistItemResults.id })
          .from(eventChecklistItemResults)
          .where(
            and(
              eq(eventChecklistItemResults.runId, runId),
              inArray(eventChecklistItemResults.followUpSyncState, [
                "pending",
                "needs_attention",
              ]),
            ),
          )
          .limit(1)
      )[0],
    );
  }

  private async hasOpenSiteUnsafe(runId: string) {
    return Boolean(
      (
        await this.database
          .select({ id: resourceConditionIssues.id })
          .from(resourceConditionIssues)
          .innerJoin(
            eventChecklistItemResults,
            eq(
              eventChecklistItemResults.id,
              resourceConditionIssues.checklistResultId,
            ),
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
              eq(eventChecklistItemResults.runId, runId),
              eq(eventChecklistTemplateItems.scope, "site"),
              eq(resourceConditionIssues.severity, "unsafe"),
              eq(resourceConditionIssues.state, "open"),
            ),
          )
          .limit(1)
      )[0],
    );
  }

  async projection(
    bookingId: string,
    legId: string,
  ): Promise<ChecklistLifecycleProjection> {
    const [pre, post] = await Promise.all([
      this.getRun(bookingId, legId, "pre_event"),
      this.getRun(bookingId, legId, "post_event"),
    ]);

    const [hasSiteWideUnsafeIssue, hasChecklistFollowUpNeedsAttention, readyOverride] =
      pre
        ? await Promise.all([
            this.hasOpenSiteUnsafe(pre.id),
            this.hasFollowUpNeedsAttention(pre.id),
            this.hasOverride(pre.id, "allow_ready_to_operate"),
          ])
        : [false, false, false];

    return {
      preEventChecklistState: pre?.state ?? "not_started",
      postEventChecklistState: post?.state ?? "not_started",
      readyToOperate:
        Boolean(pre) &&
        (readyOverride ||
          (pre!.state === "completed" &&
            !hasSiteWideUnsafeIssue &&
            !hasChecklistFollowUpNeedsAttention)),
      hasSiteWideUnsafeIssue,
      hasChecklistFollowUpNeedsAttention,
    };
  }

  async canFinalizeCheckout(bookingId: string, legId: string): Promise<boolean> {
    const post = await this.getRun(bookingId, legId, "post_event");
    if (!post) return false;
    if (await this.hasOverride(post.id, "allow_checkout")) return true;
    if (post.state === "completed") return true;
    return (
      post.state === "unable_to_complete" &&
      Boolean(post.unableReason?.trim())
    );
  }
}
