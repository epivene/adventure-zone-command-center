import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { communicationTemplates } from "@/db/schema";
import type { ConventionNotesPayload } from "@workspace/db/boss-work-request-schema";
import { compareWorkRequestUrgency } from "./boss-work-request-state";
import { BossWorkRequestConflictError, BossWorkRequestNotFoundError, BossWorkRequestRepository } from "./boss-work-request-repository";

type Database = NodePgDatabase<typeof schema>;

export function templateFingerprint(input: {
  templateVersion: string | null;
  subjectTemplate: string | null;
  bodyTemplate: string;
  bodyFormat: "plain_text" | "html";
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export class BossWorkRequestService {
  readonly repository: BossWorkRequestRepository;

  constructor(private readonly database: Database) {
    this.repository = new BossWorkRequestRepository(database);
  }

  async bossQueue(bossAccountId: string) {
    const requests = await this.repository.listForBoss(bossAccountId);
    const active = requests
      .filter((request) => !["approved", "applied", "cancelled", "changes_requested"].includes(request.state))
      .sort(compareWorkRequestUrgency);
    const recentlyCompleted = requests
      .filter((request) => ["approved", "applied"].includes(request.state))
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
      .slice(0, 10);
    return { active, recentlyCompleted };
  }

  async bossDetail(requestId: string, bossAccountId: string) {
    const detail = await this.repository.getForBoss(requestId, bossAccountId);
    if (!detail) throw new BossWorkRequestNotFoundError("Work request not found.");
    return detail;
  }

  async ownerQueue() {
    const requests = await this.repository.listForOwner();
    return {
      needsDave: requests.filter((request) => ["waiting_on_dave", "in_progress"].includes(request.state)),
      submittedToMe: requests.filter((request) => request.state === "submitted_to_owner"),
      changesRequested: requests.filter((request) => ["changes_requested", "returned_for_clarification"].includes(request.state)),
      completed: requests.filter((request) => ["approved", "applied", "cancelled"].includes(request.state)),
    };
  }

  async ownerDetail(requestId: string) {
    const detail = await this.repository.getForOwner(requestId);
    if (!detail) throw new BossWorkRequestNotFoundError("Work request not found.");
    return detail;
  }

  async createOwnerRequest(input: {
    type: "rapid_convention_notes" | "email_template_approval" | "convention_planning_questionnaire";
    assignedBossAccountId: string;
    title: string;
    instructions?: string | null;
    priority: "normal" | "high" | "urgent";
    dueAt?: Date | null;
    deduplicationKey?: string | null;
    templateId?: string;
    ownerId: string;
  }) {
    let template: typeof communicationTemplates.$inferSelect | null = null;
    if (input.type === "email_template_approval") {
      template = (await this.database.select().from(communicationTemplates)
        .where(eq(communicationTemplates.id, input.templateId!)).limit(1))[0] ?? null;
      if (!template || template.ownerKind !== "company") {
        throw new BossWorkRequestNotFoundError("Company email template not found.");
      }
      if (template.state === "active") {
        throw new BossWorkRequestConflictError("This exact template is already active.");
      }
    }
    const created = await this.repository.create({
      type: input.type,
      priority: input.priority,
      title: input.title,
      instructions: input.instructions,
      dueAt: input.dueAt,
      createdByOwnerId: input.ownerId,
      assignedBossAccountId: input.assignedBossAccountId,
      deduplicationKey: input.deduplicationKey,
    });
    if (template && created.created) {
      await this.repository.createTemplateReview({
        requestId: created.request.id,
        templateId: template.id,
        position: 0,
        templateNameSnapshot: template.name,
        templateVersion: template.templateVersion,
        verifiedLinks: [],
        contentFingerprint: templateFingerprint({
          templateVersion: template.templateVersion,
          subjectTemplate: template.subjectTemplate,
          bodyTemplate: template.bodyTemplate,
          bodyFormat: template.bodyFormat,
        }),
        subjectSnapshot: template.subjectTemplate,
        bodySnapshot: template.bodyTemplate,
        bodyFormatSnapshot: template.bodyFormat,
      });
    }
    return this.ownerDetail(created.request.id);
  }

  saveConventionDraft(input: {
    requestId: string;
    bossAccountId: string;
    clientRevision: number;
    payload: ConventionNotesPayload;
  }) {
    return this.repository.saveDraft(input);
  }

  submitConvention(input: {
    requestId: string;
    bossAccountId: string;
    clientMutationId: string;
    payload: ConventionNotesPayload;
  }) {
    return this.repository.submitConvention(input);
  }

  updateConventionSubmission(input: {
    requestId: string;
    submissionId: string;
    bossAccountId: string;
    payload: ConventionNotesPayload;
  }) {
    return this.repository.updateConventionSubmission(input);
  }

  async decideTemplate(input: {
    requestId: string;
    bossAccountId: string;
    decision: "approved" | "changes_requested";
    note?: string | null;
  }) {
    const detail = await this.bossDetail(input.requestId, input.bossAccountId);
    if (!detail.templateReview) throw new BossWorkRequestNotFoundError("Template review not found.");
    return this.repository.decideTemplate({
      ...input,
      expectedFingerprint: detail.templateReview.contentFingerprint,
    });
  }

  returnForClarification(requestId: string, ownerId: string, note?: string | null) {
    return this.repository.transition(requestId, "returned_for_clarification", "owner", ownerId, note);
  }

  cancel(requestId: string, ownerId: string, note?: string | null) {
    return this.repository.transition(requestId, "cancelled", "owner", ownerId, note);
  }
}
