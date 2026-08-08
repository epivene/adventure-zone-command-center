import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { actReplacementRequestAudits } from "@workspace/db/schema";
import {
  actReplacementStreamTypes,
  actSafeErrorCodes,
  type ActReplacementStreamType,
  type ActSafeErrorCode,
} from "./import-types";

type DrizzleDatabase = typeof database;

export type BeginActRequestAudit = {
  runId: string;
  checkpointId: string;
  streamType: ActReplacementStreamType;
  method: "GET";
  pathTemplate: string;
  startedAt: Date;
};

export type FinishActRequestAudit = {
  auditId: string;
  state: "succeeded" | "failed";
  httpStatus: number | null;
  safeErrorCode: ActSafeErrorCode | null;
  durationMs: number;
  completedAt: Date;
};

export interface ActRequestAuditRepository {
  begin(input: BeginActRequestAudit): Promise<{ auditId: string }>;
  finish(input: FinishActRequestAudit): Promise<void>;
}

export class ActRequestAuditRepositoryError extends Error {
  readonly code = "ACT_REQUEST_AUDIT_STORE_FAILED";

  constructor() {
    super("Act request audit metadata could not be stored.");
    this.name = "ActRequestAuditRepositoryError";
  }
}

const safePathTemplates = new Set([
  "/authorize",
  "/api/companies",
  "/api/companies/{id}",
  "/api/contacts",
  "/api/contacts/{id}",
  "/api/contacts/{id}/companies",
  "/api/contacts/{id}/note",
  "/api/opportunities",
  "/api/opportunities/{id}",
  "/api/opportunities/{id}/companies",
  "/api/opportunities/{id}/contacts",
  "/api/groups",
  "/api/groups/{id}",
  "/api/groups/{id}/contacts",
  "/api/activities",
  "/api/activities/{id}",
  "/api/activities/{id}/contacts",
  "/api/activities/{id}/companies",
  "/api/activities/{id}/opportunities",
  "/api/notes",
  "/api/notes/{id}",
  "/api/notes/{id}/contacts",
  "/api/notes/{id}/companies",
  "/api/notes/{id}/opportunities",
  "/api/history",
  "/api/history/{id}",
  "/api/history/{id}/contacts",
  "/api/history/{id}/companies",
  "/api/history/{id}/opportunities",
]);

export function isSafeActPathTemplate(value: unknown): value is string {
  return typeof value === "string" && safePathTemplates.has(value);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function invalid(): never {
  throw new ActRequestAuditRepositoryError();
}

export class DrizzleActRequestAuditRepository implements ActRequestAuditRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async begin(input: BeginActRequestAudit): Promise<{ auditId: string }> {
    try {
      if (
        input.method !== "GET" ||
        !input.runId.trim() ||
        !input.checkpointId.trim() ||
        !actReplacementStreamTypes.includes(input.streamType) ||
        !isSafeActPathTemplate(input.pathTemplate) ||
        !isValidDate(input.startedAt)
      ) {
        invalid();
      }
      const [created] = await this.database
        .insert(actReplacementRequestAudits)
        .values({
          runId: input.runId,
          checkpointId: input.checkpointId,
          streamType: input.streamType,
          method: "GET",
          pathTemplate: input.pathTemplate,
          state: "started",
          startedAt: input.startedAt,
        })
        .returning({ auditId: actReplacementRequestAudits.id });
      if (!created) invalid();
      return created;
    } catch (error) {
      if (error instanceof ActRequestAuditRepositoryError) throw error;
      throw new ActRequestAuditRepositoryError();
    }
  }

  async finish(input: FinishActRequestAudit): Promise<void> {
    try {
      if (
        !input.auditId.trim() ||
        (input.state !== "succeeded" && input.state !== "failed") ||
        (input.httpStatus !== null &&
          (!Number.isInteger(input.httpStatus) ||
            input.httpStatus < 100 ||
            input.httpStatus > 599)) ||
        (input.safeErrorCode !== null &&
          !actSafeErrorCodes.includes(input.safeErrorCode)) ||
        !Number.isInteger(input.durationMs) ||
        input.durationMs < 0 ||
        !isValidDate(input.completedAt)
      ) {
        invalid();
      }
      const [finished] = await this.database
        .update(actReplacementRequestAudits)
        .set({
          state: input.state,
          httpStatus: input.httpStatus,
          safeErrorCode: input.safeErrorCode,
          durationMs: input.durationMs,
          completedAt: input.completedAt,
        })
        .where(
          and(
            eq(actReplacementRequestAudits.id, input.auditId),
            eq(actReplacementRequestAudits.state, "started"),
          ),
        )
        .returning({ auditId: actReplacementRequestAudits.id });
      if (!finished) invalid();
    } catch (error) {
      if (error instanceof ActRequestAuditRepositoryError) throw error;
      throw new ActRequestAuditRepositoryError();
    }
  }
}
