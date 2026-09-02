import { and, eq, gt, isNull, notInArray, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { computerCallSessions } from "@/db/schema";
import type { ComputerCallStatus } from "./computer-calling-types";

export type ComputerCallSessionRecord = typeof computerCallSessions.$inferSelect;

export type ComputerCallIntentRecord = ComputerCallSessionRecord;

export interface CreateComputerCallIntentRecord {
  ownerId: string;
  organizationId: string;
  contactId: string;
  phoneId: string;
  callerIdSnapshot: string;
  destinationNumberSnapshot: string;
  intentExpiresAt: Date;
  createdAt: Date;
}

export interface ProviderStatusUpdate {
  providerCallSid: string;
  status: ComputerCallStatus;
  occurredAt: Date;
  durationSeconds?: number | null;
  errorCode?: string | null;
  errorSummary?: string | null;
}

export type ConsumeIntentResult =
  | { kind: "consumed" | "retry"; session: ComputerCallSessionRecord }
  | { kind: "expired" | "already_bound" | "not_found" };

export interface ComputerCallRepository {
  createIntent(input: CreateComputerCallIntentRecord): Promise<ComputerCallIntentRecord>;
  consumeIntent(input: {
    id: string;
    providerCallSid: string;
    callerIdentity: string;
    now: Date;
  }): Promise<ConsumeIntentResult>;
  updateProviderStatus(input: ProviderStatusUpdate): Promise<ComputerCallSessionRecord | null>;
  getSessionForOwner(input: {
    id: string;
    ownerId: string;
  }): Promise<ComputerCallSessionRecord | null>;
}

const terminalStatuses: ComputerCallStatus[] = [
  "completed",
  "busy",
  "no-answer",
  "canceled",
  "failed",
];

function isTerminal(status: ComputerCallStatus): boolean {
  return terminalStatuses.includes(status);
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record.code === "23505") return true;
    current = record.cause;
  }
  return false;
}

type DrizzleDatabase = typeof database;

export class DrizzleComputerCallRepository implements ComputerCallRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async createIntent(
    input: CreateComputerCallIntentRecord,
  ): Promise<ComputerCallIntentRecord> {
    const [created] = await this.database.insert(computerCallSessions).values({
      ownerId: input.ownerId,
      organizationId: input.organizationId,
      contactId: input.contactId,
      phoneId: input.phoneId,
      provider: "twilio",
      direction: "outbound",
      method: "browser_voip",
      status: "created",
      callerIdSnapshot: input.callerIdSnapshot,
      destinationNumberSnapshot: input.destinationNumberSnapshot,
      intentExpiresAt: input.intentExpiresAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }).returning();

    if (!created) throw new Error("Failed to create computer call intent");
    return created;
  }

  async consumeIntent(input: {
    id: string;
    providerCallSid: string;
    callerIdentity: string;
    now: Date;
  }): Promise<ConsumeIntentResult> {
    let consumed: ComputerCallSessionRecord | undefined;
    try {
      [consumed] = await this.database
        .update(computerCallSessions)
        .set({
          providerCallSid: input.providerCallSid,
          intentConsumedAt: input.now,
          updatedAt: input.now,
        })
        .where(and(
          eq(computerCallSessions.id, input.id),
          eq(computerCallSessions.ownerId, input.callerIdentity),
          isNull(computerCallSessions.intentConsumedAt),
          gt(computerCallSessions.intentExpiresAt, input.now),
          sql`not exists (
            select 1
            from computer_call_sessions as provider_session
            where provider_session.provider_call_sid = ${input.providerCallSid}
          )`,
        ))
        .returning();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.classifyConsumeConflict(input);
    }

    if (consumed) return { kind: "consumed", session: consumed };

    return this.classifyConsumeConflict(input);
  }

  private async classifyConsumeConflict(input: {
    id: string;
    providerCallSid: string;
    callerIdentity: string;
    now: Date;
  }): Promise<ConsumeIntentResult> {
    const [existing] = await this.database
      .select()
      .from(computerCallSessions)
      .where(and(
        eq(computerCallSessions.id, input.id),
        eq(computerCallSessions.ownerId, input.callerIdentity),
      ))
      .limit(1);

    if (!existing) return { kind: "not_found" };
    if (existing.providerCallSid === input.providerCallSid) {
      return { kind: "retry", session: existing };
    }
    if (existing.intentConsumedAt || existing.providerCallSid) {
      return { kind: "already_bound" };
    }
    if (existing.intentExpiresAt <= input.now) return { kind: "expired" };
    return { kind: "already_bound" };
  }

  async updateProviderStatus(
    input: ProviderStatusUpdate,
  ): Promise<ComputerCallSessionRecord | null> {
    const terminal = isTerminal(input.status);
    const [updated] = await this.database
      .update(computerCallSessions)
      .set({
        status: input.status,
        startedAt: input.status === "queued" || input.status === "ringing"
          || input.status === "in-progress"
          ? sql`coalesce(${computerCallSessions.startedAt}, ${input.occurredAt})`
          : undefined,
        answeredAt: input.status === "in-progress"
          ? sql`coalesce(${computerCallSessions.answeredAt}, ${input.occurredAt})`
          : undefined,
        endedAt: terminal ? input.occurredAt : undefined,
        updatedAt: input.occurredAt,
        durationSeconds: input.durationSeconds,
        errorCode: input.errorCode,
        errorSummary: input.errorSummary,
      })
      .where(and(
        eq(computerCallSessions.providerCallSid, input.providerCallSid),
        notInArray(computerCallSessions.status, terminalStatuses),
      ))
      .returning();

    if (updated) return updated;

    const [existing] = await this.database
      .select()
      .from(computerCallSessions)
      .where(eq(computerCallSessions.providerCallSid, input.providerCallSid))
      .limit(1);
    return existing ?? null;
  }

  async getSessionForOwner(input: {
    id: string;
    ownerId: string;
  }): Promise<ComputerCallSessionRecord | null> {
    const [session] = await this.database
      .select()
      .from(computerCallSessions)
      .where(and(
        eq(computerCallSessions.id, input.id),
        eq(computerCallSessions.ownerId, input.ownerId),
      ))
      .limit(1);
    return session ?? null;
  }
}
