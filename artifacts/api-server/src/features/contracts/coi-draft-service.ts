import { eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { contractCoiDrafts, contractVersions } from "@/db/schema";
import { buildGmailRawMessage } from "@/features/google-workspace/google-api-client";
import type { GoogleGmailDraftClient } from "@/features/google-workspace/google-api-types";
import type { ContractSnapshot } from "./contract-draft-service";

export type CoiDraftInput = {
  eventName: string;
  eventStartDate: string;
  eventEndDate: string;
  certificateHolderName: string;
  certificateHolderAddress: string;
  additionalInsuredWording: string;
  recipientName: string;
  recipientEmail: string;
};

export type CoiDraftRecord = {
  id: string;
  contractVersionId: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  state: "details_needed" | "prepared" | "created" | "retryable_error" | "manual_review";
  googleConnectionId: string | null;
  gmailDraftId: string | null;
  gmailMessageId: string | null;
  lastErrorCode: string | null;
  idempotencyKey: string;
  attemptCount: number;
  completedAt: Date | null;
  updatedAt: Date;
};

export type CoiContext = {
  contractVersionId: string;
  status: string;
  values: ContractSnapshot["values"];
  recipient: { name: string; email: string };
};

type Evidence = {
  contractVersionId: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  now: Date;
};

export interface CoiDraftPersistence {
  loadContext(contractVersionId: string): Promise<CoiContext | null>;
  get(contractVersionId: string): Promise<CoiDraftRecord | null>;
  detailsNeeded(input: Evidence): Promise<CoiDraftRecord>;
  reserve(input: Evidence): Promise<{ record: CoiDraftRecord; shouldCall: boolean }>;
  outcome(input: {
    contractVersionId: string;
    state: "created" | "retryable_error" | "manual_review";
    googleConnectionId: string | null;
    gmailDraftId: string | null;
    gmailMessageId: string | null;
    lastErrorCode: string | null;
    completedAt: Date | null;
    now: Date;
  }): Promise<CoiDraftRecord>;
}

export interface CoiGmailDraftProvider {
  createDraft(input: { to: string; subject: string; body: string }): Promise<{ connectionId: string; draftId: string; messageId: string }>;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function displayRange(start: string, end: string) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  if (startYear === endYear && startMonth === endMonth) {
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(startYear ?? 0, (startMonth ?? 1) - 1, 1)));
    return `${month} ${startDay}–${endDay}, ${startYear}`;
  }
  return `${displayDate(start)}–${displayDate(end)}`;
}

export function evaluateCoiReadiness(input: CoiDraftInput) {
  const fields: Array<keyof CoiDraftInput> = [
    "eventName", "eventStartDate", "eventEndDate", "certificateHolderName", "certificateHolderAddress",
    "additionalInsuredWording", "recipientName", "recipientEmail",
  ];
  const missing = fields.filter((field) => !input[field].trim());
  return { ready: missing.length === 0, missing };
}

export function buildCoiDraft(input: CoiDraftInput) {
  const body = [
    `Hi ${input.recipientName.split(/\s+/)[0] || "Sara"},`,
    "",
    "This is Desiree from The Adventure Zone. I work with David Gordon. We are requesting a COI for an upcoming event. Thanks so much!",
    "",
    "The language for this COI requested by the sponsoring body is as follows:",
    input.additionalInsuredWording,
    "",
    "The event dates:",
    displayRange(input.eventStartDate, input.eventEndDate),
    "",
    "Additionally Insured Info:",
    input.certificateHolderName,
    ...input.certificateHolderAddress.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    "",
    "Desiree Conklin",
    "The Adventure Zone",
    "+1 (435)-760-5583  ⭐ https://www.the-adventure-zone.com/",
    "TheAdventureZone12@gmail.com",
  ].join("\n");
  return { to: input.recipientEmail.trim().toLowerCase(), subject: `COI Request for ${input.eventName}`, body };
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN";
}

export class CoiDraftService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: { persistence: CoiDraftPersistence; provider: CoiGmailDraftProvider; now?: () => Date }) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async createOrRecover(input: { contractVersionId: string; actorId: string }) {
    const context = await this.dependencies.persistence.loadContext(input.contractVersionId);
    if (!context) throw new Error("CONTRACT_VERSION_NOT_FOUND");
    if (context.status !== "completed") throw new Error("CONTRACT_NOT_COMPLETED");
    const value: CoiDraftInput = {
      eventName: context.values.eventName,
      eventStartDate: context.values.eventStartDate,
      eventEndDate: context.values.eventEndDate,
      certificateHolderName: context.values.coi.certificateHolderName,
      certificateHolderAddress: context.values.coi.certificateHolderAddress,
      additionalInsuredWording: context.values.coi.additionalInsuredWording,
      recipientName: context.recipient.name,
      recipientEmail: context.recipient.email,
    };
    const draft = buildCoiDraft(value);
    const evidence: Evidence = {
      contractVersionId: input.contractVersionId,
      recipientName: value.recipientName,
      recipientEmail: draft.to,
      subject: draft.subject,
      body: draft.body,
      idempotencyKey: `contract-coi:${input.contractVersionId}`,
      now: this.now(),
    };
    if (!evaluateCoiReadiness(value).ready) {
      return { record: await this.dependencies.persistence.detailsNeeded(evidence), reused: false };
    }
    const reservation = await this.dependencies.persistence.reserve(evidence);
    if (!reservation.shouldCall) return { record: reservation.record, reused: reservation.record.state === "created" };
    try {
      const created = await this.dependencies.provider.createDraft({ to: draft.to, subject: draft.subject, body: draft.body });
      return { record: await this.dependencies.persistence.outcome({
        contractVersionId: input.contractVersionId, state: "created", googleConnectionId: created.connectionId,
        gmailDraftId: created.draftId, gmailMessageId: created.messageId, lastErrorCode: null,
        completedAt: this.now(), now: this.now(),
      }), reused: false };
    } catch (error) {
      const code = errorCode(error);
      const state = code === "GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN" ? "manual_review" as const : "retryable_error" as const;
      return { record: await this.dependencies.persistence.outcome({
        contractVersionId: input.contractVersionId, state, googleConnectionId: null,
        gmailDraftId: null, gmailMessageId: null, lastErrorCode: code, completedAt: null, now: this.now(),
      }), reused: false };
    }
  }
}

function record(row: typeof contractCoiDrafts.$inferSelect): CoiDraftRecord {
  return row;
}

type Database = typeof database;
export class DrizzleCoiDraftPersistence implements CoiDraftPersistence {
  constructor(private readonly database: Database) {}
  async loadContext(contractVersionId: string) {
    const [row] = await this.database.select({ id: contractVersions.id, status: contractVersions.status, snapshot: contractVersions.snapshot })
      .from(contractVersions).where(eq(contractVersions.id, contractVersionId)).limit(1);
    if (!row) return null;
    const snapshot = row.snapshot as ContractSnapshot;
    return { contractVersionId: row.id, status: row.status, values: snapshot.values, recipient: snapshot.insuranceRecipient };
  }
  async get(contractVersionId: string) {
    const [row] = await this.database.select().from(contractCoiDrafts).where(eq(contractCoiDrafts.contractVersionId, contractVersionId)).limit(1);
    return row ? record(row) : null;
  }
  async detailsNeeded(input: Evidence) {
    const [row] = await this.database.insert(contractCoiDrafts).values({
      ...input, state: "details_needed", attemptCount: 0, createdAt: input.now, updatedAt: input.now,
    }).onConflictDoUpdate({ target: contractCoiDrafts.contractVersionId, set: {
      recipientName: input.recipientName, recipientEmail: input.recipientEmail, subject: input.subject, body: input.body,
      state: "details_needed", updatedAt: input.now,
    } }).returning();
    if (!row) throw new Error("CONTRACT_COI_DRAFT_CREATE_FAILED");
    return record(row);
  }
  async reserve(input: Evidence) {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction.select().from(contractCoiDrafts)
        .where(eq(contractCoiDrafts.contractVersionId, input.contractVersionId)).for("update").limit(1);
      if (current?.state === "created") return { record: record(current), shouldCall: false };
      if (current?.state === "prepared" || current?.state === "manual_review") {
        if (current.state === "prepared") {
          const [manual] = await transaction.update(contractCoiDrafts).set({ state: "manual_review", lastErrorCode: "COI_DRAFT_PRIOR_OUTCOME_UNCERTAIN", updatedAt: input.now })
            .where(eq(contractCoiDrafts.id, current.id)).returning();
          return { record: record(manual!), shouldCall: false };
        }
        return { record: record(current), shouldCall: false };
      }
      if (current) {
        const [updated] = await transaction.update(contractCoiDrafts).set({
          recipientName: input.recipientName, recipientEmail: input.recipientEmail, subject: input.subject, body: input.body,
          state: "prepared", idempotencyKey: input.idempotencyKey, attemptCount: current.attemptCount + 1,
          lastErrorCode: null, lastAttemptAt: input.now, updatedAt: input.now,
        }).where(eq(contractCoiDrafts.id, current.id)).returning();
        return { record: record(updated!), shouldCall: true };
      }
      const [created] = await transaction.insert(contractCoiDrafts).values({
        ...input, state: "prepared", attemptCount: 1, lastAttemptAt: input.now, createdAt: input.now, updatedAt: input.now,
      }).returning();
      if (!created) throw new Error("CONTRACT_COI_DRAFT_CREATE_FAILED");
      return { record: record(created), shouldCall: true };
    });
  }
  async outcome(input: Parameters<CoiDraftPersistence["outcome"]>[0]) {
    const [row] = await this.database.update(contractCoiDrafts).set({
      state: input.state, googleConnectionId: input.googleConnectionId, gmailDraftId: input.gmailDraftId,
      gmailMessageId: input.gmailMessageId, lastErrorCode: input.lastErrorCode,
      completedAt: input.completedAt, updatedAt: input.now,
    }).where(eq(contractCoiDrafts.contractVersionId, input.contractVersionId)).returning();
    if (!row) throw new Error("CONTRACT_COI_DRAFT_UPDATE_FAILED");
    return record(row);
  }
}

type DraftConnection = { createGmailDraftClient(): Promise<{ connectionId: string; client: GoogleGmailDraftClient } | null> };
export class GoogleCoiGmailDraftProvider implements CoiGmailDraftProvider {
  constructor(private readonly connection: DraftConnection) {}
  async createDraft(input: { to: string; subject: string; body: string }) {
    const connected = await this.connection.createGmailDraftClient();
    if (!connected) throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_WORKSPACE_NOT_CONNECTED" });
    const created = await connected.client.createGmailDraft({ raw: buildGmailRawMessage(input) });
    return { connectionId: connected.connectionId, draftId: created.draftId, messageId: created.messageId };
  }
}
