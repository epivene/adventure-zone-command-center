import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import type {
  ChecklistFollowUpSyncState,
  ChecklistPhase,
  ChecklistResult,
} from "@workspace/db/event-checklist-schema";
import { ensureEventChecklistTemplates } from "./event-checklist-seed";
import { EventChecklistRepository } from "./event-checklist-repository";
import type { EventChecklistView } from "./event-checklist-types";
import {
  applyChecklistConditionEffect,
  resolveChecklistConditionEffect,
} from "./resource-condition-service";

type Database = NodePgDatabase<typeof schema>;

export function shouldGenerateForTags(
  applicabilityTags: readonly string[],
  resourceTags: readonly string[],
): boolean {
  if (applicabilityTags.length === 0) return true;
  const resource = new Set(resourceTags);
  return applicabilityTags.some((tag) => resource.has(tag));
}

export function validateChecklistAnswer(
  result: ChecklistResult,
  note: string | null,
  safetyCritical: boolean,
): string | null {
  const hasNote = Boolean(note?.trim());
  if ((result === "needs_work_safe" || result === "unsafe") && !hasNote) {
    return "A note is required for this result.";
  }
  if (result === "not_applicable" && safetyCritical && !hasNote) {
    return "An explanation is required when a safety-critical item is not applicable.";
  }
  return null;
}

export function canCompleteChecklist(
  items: Array<{
    result: ChecklistResult | null;
    followUpSyncState: ChecklistFollowUpSyncState;
  }>,
): { allowed: boolean; reason: string | null } {
  if (items.some((item) => item.result === null)) {
    return { allowed: false, reason: "Every checklist item needs an answer." };
  }
  if (
    items.some(
      (item) =>
        item.followUpSyncState === "pending" ||
        item.followUpSyncState === "needs_attention",
    )
  ) {
    return {
      allowed: false,
      reason: "Safety follow-up still needs attention.",
    };
  }
  return { allowed: true, reason: null };
}

function resultNeedsConditionEffect(
  result: ChecklistResult | null,
): result is "needs_work_safe" | "unsafe" {
  return result === "needs_work_safe" || result === "unsafe";
}

export class EventChecklistService {
  readonly repository: EventChecklistRepository;

  constructor(private readonly database: Database) {
    this.repository = new EventChecklistRepository(database);
  }

  async get(
    bookingId: string,
    legId: string,
    phase: ChecklistPhase,
  ): Promise<EventChecklistView | null> {
    if (!(await this.repository.bookingBelongsToLeg(bookingId, legId))) {
      throw new Error("CHECKLIST_OUTSIDE_LEG");
    }
    const run = await this.repository.getRun(bookingId, legId, phase);
    return run ? this.repository.view(run.id) : null;
  }

  async ensureRun(input: {
    bookingId: string;
    legId: string;
    phase: ChecklistPhase;
    clientMutationId: string;
  }): Promise<EventChecklistView> {
    if (!(await this.repository.bookingBelongsToLeg(input.bookingId, input.legId))) {
      throw new Error("CHECKLIST_OUTSIDE_LEG");
    }

    await ensureEventChecklistTemplates(this.database as any);
    let run = await this.repository.getRun(
      input.bookingId,
      input.legId,
      input.phase,
    );
    if (!run) {
      const template = await this.repository.activeTemplate(input.phase);
      if (!template) throw new Error("CHECKLIST_TEMPLATE_MISSING");
      run = await this.repository.createRun({
        bookingId: input.bookingId,
        legId: input.legId,
        phase: input.phase,
        templateId: template.id,
        clientMutationId: input.clientMutationId,
        startedAt: new Date(),
      });
      if (!run) throw new Error("CHECKLIST_RUN_CREATE_FAILED");
    }

    const [templateItems, assignedResources] = await Promise.all([
      this.repository.listTemplateItems(run.templateId),
      this.repository.assignedResources(input.bookingId),
    ]);
    const generated: Array<{
      templateItemId: string;
      itemCode: string;
      label: string;
      resourceId: string | null;
      resourceName: string | null;
    }> = [];
    for (const item of templateItems) {
      if (item.scope === "site") {
        generated.push({
          templateItemId: item.id,
          itemCode: item.code,
          label: item.label,
          resourceId: null,
          resourceName: null,
        });
        continue;
      }
      for (const resource of assignedResources) {
        if (!shouldGenerateForTags(item.applicabilityTags, resource.checklistTags)) {
          continue;
        }
        generated.push({
          templateItemId: item.id,
          itemCode: item.code,
          label: item.label,
          resourceId: resource.id,
          resourceName: resource.name,
        });
      }
    }
    await this.repository.createGeneratedResults({ runId: run.id, items: generated });
    const view = await this.repository.view(run.id);
    if (!view) throw new Error("CHECKLIST_RUN_NOT_FOUND");
    return view;
  }

  private async synchronizeConditionEffect(input: {
    resultId: string;
    bookingId: string;
    resourceId: string | null;
    result: ChecklistResult;
    note: string | null;
    summary: string;
  }): Promise<void> {
    try {
      if (resultNeedsConditionEffect(input.result)) {
        await applyChecklistConditionEffect(this.database, {
          checklistResultId: input.resultId,
          bookingId: input.bookingId,
          resourceId: input.resourceId,
          result: input.result,
          summary: input.summary,
          note: input.note!.trim(),
        });
      } else {
        await resolveChecklistConditionEffect(this.database, input.resultId);
      }
      await this.repository.setFollowUpSyncState(input.resultId, "synced");
    } catch {
      await this.repository.setFollowUpSyncState(
        input.resultId,
        "needs_attention",
      );
    }
  }

  async saveResult(input: {
    resultId: string;
    legId: string;
    result: ChecklistResult;
    note: string | null;
    clientMutationId: string;
  }): Promise<EventChecklistView> {
    const existing = await this.repository.resultForLeg(input.resultId, input.legId);
    if (!existing) throw new Error("CHECKLIST_RESULT_NOT_FOUND");
    if (existing.run.state !== "in_progress") {
      throw new Error("CHECKLIST_RUN_CLOSED");
    }

    const summary = `${existing.result.resourceNameSnapshot ?? "Event site"}: ${existing.result.itemLabelSnapshot}`;

    if (existing.result.clientMutationId === input.clientMutationId) {
      if (
        existing.result.followUpSyncState === "pending" ||
        existing.result.followUpSyncState === "needs_attention"
      ) {
        if (!existing.result.result) throw new Error("CHECKLIST_RESULT_NOT_FOUND");
        await this.synchronizeConditionEffect({
          resultId: input.resultId,
          bookingId: existing.run.bookingId,
          resourceId: existing.result.resourceId,
          result: existing.result.result,
          note: existing.result.note,
          summary,
        });
      }
      const retryView = await this.repository.view(existing.run.id);
      if (!retryView) throw new Error("CHECKLIST_RUN_NOT_FOUND");
      return retryView;
    }

    const validation = validateChecklistAnswer(
      input.result,
      input.note,
      existing.item.safetyCritical,
    );
    if (validation) throw new Error(`CHECKLIST_INVALID_ANSWER:${validation}`);

    const newNeedsFollowUp = resultNeedsConditionEffect(input.result);
    const priorHadCondition = resultNeedsConditionEffect(existing.result.result);
    const conditionSyncRequired = newNeedsFollowUp || priorHadCondition;

    await this.repository.updateResult({
      resultId: input.resultId,
      result: input.result,
      note: input.note,
      followUpSyncState: conditionSyncRequired ? "pending" : "not_required",
      clientMutationId: input.clientMutationId,
    });

    if (conditionSyncRequired) {
      await this.synchronizeConditionEffect({
        resultId: input.resultId,
        bookingId: existing.run.bookingId,
        resourceId: existing.result.resourceId,
        result: input.result,
        note: input.note,
        summary,
      });
    }

    const view = await this.repository.view(existing.run.id);
    if (!view) throw new Error("CHECKLIST_RUN_NOT_FOUND");
    return view;
  }

  async complete(
    bookingId: string,
    legId: string,
    phase: ChecklistPhase,
  ): Promise<EventChecklistView> {
    const view = await this.get(bookingId, legId, phase);
    if (!view) throw new Error("CHECKLIST_NOT_STARTED");
    if (view.state === "completed") return view;
    if (view.state !== "in_progress") throw new Error("CHECKLIST_RUN_CLOSED");
    const completion = canCompleteChecklist(view.items);
    if (!completion.allowed) {
      throw new Error(`CHECKLIST_NOT_COMPLETE:${completion.reason}`);
    }
    await this.repository.completeRun(view.id);
    const updated = await this.repository.view(view.id);
    if (!updated) throw new Error("CHECKLIST_RUN_NOT_FOUND");
    return updated;
  }

  async unableToComplete(
    bookingId: string,
    legId: string,
    phase: ChecklistPhase,
    reason: string,
  ): Promise<EventChecklistView> {
    if (!reason.trim()) throw new Error("CHECKLIST_UNABLE_REASON_REQUIRED");
    const view = await this.get(bookingId, legId, phase);
    if (!view) throw new Error("CHECKLIST_NOT_STARTED");
    if (view.state !== "in_progress") return view;
    await this.repository.markUnable(view.id, reason);
    const updated = await this.repository.view(view.id);
    if (!updated) throw new Error("CHECKLIST_RUN_NOT_FOUND");
    return updated;
  }
}
