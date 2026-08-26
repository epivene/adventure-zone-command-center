import { eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { leadGmailDraftLinks, organizations } from "@/db/schema";
import type { GoogleGmailDraftClient } from "../google-workspace/google-api-types";
import { buildGmailRawMessage } from "../google-workspace/google-api-client";
import { buildLeadEmailPreview } from "./lead-email-preview-service";
import { LeadEmailPreviewRepository, LeadEmailPreviewRepositoryError, type LeadEmailPreviewRepositoryResult } from "./lead-email-preview-repository";

type Database = typeof database;
export type LeadGmailDraftState = "prepared" | "created" | "retryable_error" | "manual_review";
export type LeadGmailDraftLink = {
  id: string; rowId: string; organizationId: string; contactId: string | null;
  googleConnectionId: string; communicationTemplateId: string; templateVersion: string;
  recipientEmail: string; subject: string; body: string; gmailDraftId: string | null;
  gmailMessageId: string | null; state: LeadGmailDraftState; lastErrorCode: string | null;
  idempotencyKey: string; attemptCount: number; actorId: string; createdAt: string;
  updatedAt: string; lastAttemptAt: string; completedAt: string | null;
};
export type LeadGmailDraftListItem = Pick<LeadGmailDraftLink, "id" | "rowId" | "recipientEmail" | "subject" | "state" | "gmailDraftId" | "lastErrorCode" | "updatedAt"> & { profileName: string };
type PreparedEvidence = Pick<LeadGmailDraftLink, "organizationId" | "contactId" | "communicationTemplateId" | "templateVersion" | "recipientEmail" | "subject" | "body">;
export type GmailDraftAttempt = { kind: "created"; draftId: string; messageId: string } | { kind: "retryable_error" | "manual_review"; errorCode: string };

export interface GmailDraftPersistence {
  findByRow(rowId: string): Promise<LeadGmailDraftLink | null>;
  prepare(input: {
    rowId: string; expectedVersion: number; googleConnectionId: string; actorId: string;
    idempotencyKey: string; now: Date;
    evaluate(state: LeadEmailPreviewRepositoryResult): PreparedEvidence;
  }): Promise<{ kind: "created" | "manual_review" | "prepared"; link: LeadGmailDraftLink }>;
  execute(input: {
    rowId: string; expectedVersion: number; idempotencyKey: string; now: Date;
    attempt(state: LeadEmailPreviewRepositoryResult, link: LeadGmailDraftLink): Promise<GmailDraftAttempt>;
  }): Promise<LeadGmailDraftLink>;
}
type DraftConnection = { createGmailDraftClient(): Promise<{ connectionId: string; client: GoogleGmailDraftClient } | null> };

export class GmailDraftServiceError extends Error {
  readonly blockers: string[];
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message); this.name = "GmailDraftServiceError";
    this.blockers = Array.isArray(details.blockers) ? details.blockers.filter((v): v is string => typeof v === "string") : [];
  }
}
function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error("LEAD_GMAIL_DRAFT_DATE_INVALID");
  return date.toISOString();
}
function toLink(row: typeof leadGmailDraftLinks.$inferSelect): LeadGmailDraftLink {
  return {
    id: row.id, rowId: row.rowId, organizationId: row.organizationId, contactId: row.contactId,
    googleConnectionId: row.googleConnectionId, communicationTemplateId: row.communicationTemplateId,
    templateVersion: row.templateVersion, recipientEmail: row.recipientEmail, subject: row.subject,
    body: row.body, gmailDraftId: row.gmailDraftId, gmailMessageId: row.gmailMessageId,
    state: row.state, lastErrorCode: row.lastErrorCode, idempotencyKey: row.idempotencyKey,
    attemptCount: row.attemptCount, actorId: row.actorId, createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!, lastAttemptAt: iso(row.lastAttemptAt)!, completedAt: iso(row.completedAt),
  };
}
function translate(error: unknown): never {
  if (error instanceof LeadEmailPreviewRepositoryError) throw new GmailDraftServiceError(error.code, error.message, error.details);
  throw error;
}

export class PostgresGmailDraftPersistence implements GmailDraftPersistence {
  constructor(private readonly database: Database, private readonly preview: LeadEmailPreviewRepository) {}
  async findByRow(rowId: string) {
    const [row] = await this.database.select().from(leadGmailDraftLinks).where(eq(leadGmailDraftLinks.rowId, rowId)).limit(1);
    return row ? toLink(row) : null;
  }
  async prepare(input: Parameters<GmailDraftPersistence["prepare"]>[0]) {
    try {
      return await this.preview.withSerializedState(input.rowId, input.expectedVersion, async (state, tx) => {
        const [current] = await tx.select().from(leadGmailDraftLinks).where(eq(leadGmailDraftLinks.rowId, input.rowId)).limit(1).for("update");
        if (current?.state === "created") return { kind: "created" as const, link: toLink(current) };
        if (current?.state === "prepared" || current?.state === "manual_review") return { kind: "manual_review" as const, link: toLink(current) };
        const evidence = input.evaluate(state);
        if (current) {
          const [updated] = await tx.update(leadGmailDraftLinks).set({
            ...evidence, googleConnectionId: input.googleConnectionId, state: "prepared", lastErrorCode: null,
            actorId: input.actorId, attemptCount: current.attemptCount + 1, updatedAt: input.now,
            lastAttemptAt: input.now, completedAt: null,
          }).where(eq(leadGmailDraftLinks.id, current.id)).returning();
          return { kind: "prepared" as const, link: toLink(updated!) };
        }
        const [created] = await tx.insert(leadGmailDraftLinks).values({
          rowId: input.rowId, ...evidence, googleConnectionId: input.googleConnectionId, state: "prepared",
          idempotencyKey: input.idempotencyKey, attemptCount: 1, actorId: input.actorId,
          createdAt: input.now, updatedAt: input.now, lastAttemptAt: input.now,
        }).returning();
        return { kind: "prepared" as const, link: toLink(created!) };
      });
    } catch (error) { return translate(error); }
  }
  async execute(input: Parameters<GmailDraftPersistence["execute"]>[0]) {
    try {
      return await this.preview.withSerializedState(input.rowId, input.expectedVersion, async (state, tx) => {
        const [current] = await tx.select().from(leadGmailDraftLinks).where(eq(leadGmailDraftLinks.rowId, input.rowId)).limit(1).for("update");
        if (!current || current.idempotencyKey !== input.idempotencyKey) throw new GmailDraftServiceError("DRAFT_RESERVATION_MISSING", "The Gmail draft reservation is missing.");
        if (current.state !== "prepared") return toLink(current);
        const outcome = await input.attempt(state, toLink(current));
        const [updated] = await tx.update(leadGmailDraftLinks).set(outcome.kind === "created" ? {
          state: "created", gmailDraftId: outcome.draftId, gmailMessageId: outcome.messageId,
          lastErrorCode: null, completedAt: input.now, updatedAt: input.now,
        } : { state: outcome.kind, lastErrorCode: outcome.errorCode, updatedAt: input.now })
          .where(eq(leadGmailDraftLinks.id, current.id)).returning();
        return toLink(updated!);
      });
    } catch (error) { return translate(error); }
  }
  async listForOffice(): Promise<LeadGmailDraftListItem[]> {
    const rows = await this.database.select({
      id: leadGmailDraftLinks.id, rowId: leadGmailDraftLinks.rowId, profileName: organizations.name,
      recipientEmail: leadGmailDraftLinks.recipientEmail, subject: leadGmailDraftLinks.subject,
      state: leadGmailDraftLinks.state, gmailDraftId: leadGmailDraftLinks.gmailDraftId,
      lastErrorCode: leadGmailDraftLinks.lastErrorCode, updatedAt: leadGmailDraftLinks.updatedAt,
    }).from(leadGmailDraftLinks).innerJoin(organizations, eq(organizations.id, leadGmailDraftLinks.organizationId));
    return rows.map((row) => ({ ...row, updatedAt: iso(row.updatedAt)! }));
  }
}

function evidence(state: LeadEmailPreviewRepositoryResult, now: Date): PreparedEvidence {
  const preview = buildLeadEmailPreview({ ...state, now });
  if (!preview.readiness.ready || !preview.subject || !preview.body || !state.approvedTemplate || !state.lead.organizationId) {
    throw new GmailDraftServiceError("NOT_READY", "This lead is no longer ready for Gmail draft creation.", { blockers: preview.readiness.blockers });
  }
  return {
    organizationId: state.lead.organizationId, contactId: state.lead.contactId ?? null,
    communicationTemplateId: state.approvedTemplate.templateId, templateVersion: state.approvedTemplate.version,
    recipientEmail: preview.recipient.trim().toLowerCase(), subject: preview.subject, body: preview.body,
  };
}
function same(link: LeadGmailDraftLink, value: PreparedEvidence) {
  return link.organizationId === value.organizationId && link.contactId === value.contactId
    && link.communicationTemplateId === value.communicationTemplateId && link.templateVersion === value.templateVersion
    && link.recipientEmail === value.recipientEmail && link.subject === value.subject && link.body === value.body;
}
function code(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  return error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_") ? error.message : "GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN";
}

export class GmailDraftService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: { persistence: GmailDraftPersistence; connection: DraftConnection; now?: () => Date }) {
    this.now = dependencies.now ?? (() => new Date());
  }
  async create(input: { rowId: string; expectedVersion: number; actorId: string }): Promise<{ link: LeadGmailDraftLink; reused: boolean }> {
    const existing = await this.dependencies.persistence.findByRow(input.rowId);
    if (existing?.state === "created") return { link: existing, reused: true };
    if (existing?.state === "prepared" || existing?.state === "manual_review") throw new GmailDraftServiceError("MANUAL_REVIEW_REQUIRED", "Check Gmail for an existing draft before any retry.");
    let connected: Awaited<ReturnType<DraftConnection["createGmailDraftClient"]>>;
    try { connected = await this.dependencies.connection.createGmailDraftClient(); }
    catch (error) { throw new GmailDraftServiceError(code(error), "Reconnect Google with Gmail compose access before creating a draft."); }
    if (!connected) throw new GmailDraftServiceError("GOOGLE_WORKSPACE_NOT_CONNECTED", "Connect the Adventure Zone Google account first.");
    const now = this.now();
    const idempotencyKey = `lead-gmail:${input.rowId}`;
    const prepared = await this.dependencies.persistence.prepare({
      ...input, googleConnectionId: connected.connectionId, idempotencyKey, now,
      evaluate: (state) => evidence(state, now),
    });
    if (prepared.kind === "created") return { link: prepared.link, reused: true };
    if (prepared.kind === "manual_review") throw new GmailDraftServiceError("MANUAL_REVIEW_REQUIRED", "Check Gmail for an existing draft before any retry.");
    const finished = this.now();
    const result = await this.dependencies.persistence.execute({
      rowId: input.rowId, expectedVersion: input.expectedVersion, idempotencyKey, now: finished,
      attempt: async (state, reserved) => {
        const current = evidence(state, finished);
        if (reserved.googleConnectionId !== connected!.connectionId || !same(reserved, current)) return { kind: "manual_review", errorCode: "LEAD_GMAIL_DRAFT_EVIDENCE_CHANGED" };
        try {
          const created = await connected!.client.createGmailDraft({ raw: buildGmailRawMessage({ to: current.recipientEmail, subject: current.subject, body: current.body }) });
          return { kind: "created", draftId: created.draftId, messageId: created.messageId };
        } catch (error) {
          const errorCode = code(error);
          return { kind: errorCode === "GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN" ? "manual_review" : "retryable_error", errorCode };
        }
      },
    });
    if (result.state !== "created") throw new GmailDraftServiceError(result.lastErrorCode ?? "GOOGLE_WORKSPACE_GMAIL_DRAFT_CREATE_FAILED", result.state === "manual_review" ? "Gmail draft outcome is uncertain. Check Gmail before any retry." : "Google rejected the draft request. Review and retry this same lead record.", { linkId: result.id, state: result.state });
    return { link: result, reused: false };
  }
}
