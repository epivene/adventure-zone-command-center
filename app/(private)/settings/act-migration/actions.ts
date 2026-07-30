"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createActMigrationCaptureService,
  createActMigrationPreviewService,
} from "@/features/act-migration/runtime";
import {
  ActMigrationLeaseConflictError,
  ActMigrationRunConflictError,
  ActMigrationRunNotFoundError,
  type SnapshotProgress,
} from "@/features/act-migration/snapshot-repository";
import type {
  MigrationPreviewQuery,
  StoredMigrationPreviewPage,
} from "@/features/act-migration/preview-repository";
import {
  migrationDecisionValues,
  migrationPreviewStateValues,
  migrationTargetEntityTypeValues,
} from "@/features/act-migration/migration-types";
import { ActApiError } from "@/features/act-sync/act-errors";
import { requireOwner } from "@/lib/auth/require-owner";
import { getActEnvironment } from "@/lib/env";

export const ACT_MIGRATION_PREVIEW_MAX_PAGE = 1_000_000;
export const ACT_MIGRATION_PROPOSAL_KEY_MAX_LENGTH = 500;
export const ACT_MIGRATION_SOURCE_ID_MAX_LENGTH = 500;
export const ACT_MIGRATION_IGNORE_REASON_MAX_LENGTH = 2_000;

export type ActMigrationActionError = {
  ok: false;
  error: string;
  retryable: boolean;
  retryAfter: string | null;
};

export type ActMigrationProgressActionResult =
  | {
      ok: true;
      changed: boolean;
      runId: string;
      progress: SnapshotProgress;
    }
  | ActMigrationActionError;

export type ActMigrationPreviewActionResult =
  | {
      ok: true;
      changed: boolean;
      runId: string;
      preview: StoredMigrationPreviewPage;
    }
  | ActMigrationActionError;

export type ActMigrationDecisionActionResult =
  | {
      ok: true;
      changed: boolean;
      runId: string;
      proposalKey: string;
    }
  | ActMigrationActionError;

const uuidSchema = z.uuid();
const previewQuerySchema = z.object({
  targetEntityType: z.enum(migrationTargetEntityTypeValues).optional(),
  state: z.enum(migrationPreviewStateValues).optional(),
  page: z.number().safe().int().min(1).max(ACT_MIGRATION_PREVIEW_MAX_PAGE),
  pageSize: z.number().safe().int().min(1).max(100),
}).strict();
const boundedText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const decisionSchema = z.object({
  runId: uuidSchema,
  proposalKey: boundedText(ACT_MIGRATION_PROPOSAL_KEY_MAX_LENGTH),
  decision: z.enum(migrationDecisionValues),
  chosenLocalEntityId: uuidSchema.optional(),
  primarySourceId: boundedText(ACT_MIGRATION_SOURCE_ID_MAX_LENGTH).optional(),
  ignoreReason: boundedText(ACT_MIGRATION_IGNORE_REASON_MAX_LENGTH).optional(),
}).strict();

function actionError(error: unknown): ActMigrationActionError {
  if (error instanceof ActApiError) {
    return {
      ok: false,
      error: error.message,
      retryable: error.retryable,
      retryAfter: error.retryAfter,
    };
  }
  if (error instanceof ActMigrationLeaseConflictError) {
    return {
      ok: false,
      error: "Another migration worker is finishing this page. Try again.",
      retryable: true,
      retryAfter: null,
    };
  }
  if (error instanceof ActMigrationRunConflictError) {
    return {
      ok: false,
      error: "That request key belongs to a different migration request.",
      retryable: false,
      retryAfter: null,
    };
  }
  if (error instanceof ActMigrationRunNotFoundError) {
    return {
      ok: false,
      error: "The selected Act! migration run was not found.",
      retryable: false,
      retryAfter: null,
    };
  }
  return {
    ok: false,
    error: "The Act! migration could not be updated.",
    retryable: false,
    retryAfter: null,
  };
}

function interruptionError(
  progress: SnapshotProgress,
): ActMigrationActionError | null {
  const interruption = progress.interruption;
  if (!interruption) return null;
  const error = interruption.code === "unknown"
    ? "The Act! migration could not be updated."
    : new ActApiError(interruption.code, interruption.retryable).message;
  return {
    ok: false,
    error,
    retryable: interruption.retryable,
    retryAfter: interruption.retryAfter?.toISOString() ?? null,
  };
}

function changedPath(changed: boolean) {
  if (changed) revalidatePath("/settings/act-migration");
}

export async function startActMigrationAction(
  requestKey: string,
): Promise<ActMigrationProgressActionResult> {
  const actor = await requireOwner();
  const parsed = uuidSchema.safeParse(requestKey);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const environment = getActEnvironment();
    if (!environment.configured) {
      throw new ActApiError("not_configured", false);
    }
    const sourceDatabaseKey = createHash("sha256")
      .update(environment.config.databaseName.trim())
      .digest("hex");
    const result = await (await createActMigrationCaptureService()).start({
      requestKey: parsed.data,
      sourceDatabaseKey,
      requestedBy: actor.userId,
    });
    changedPath(result.created);
    return {
      ok: true,
      changed: result.created,
      runId: result.id,
      progress: result.progress,
    };
  } catch (error) {
    return actionError(error);
  }
}

async function captureAction(
  runId: string,
): Promise<ActMigrationProgressActionResult> {
  const parsed = uuidSchema.safeParse(runId);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const result = await (
      await createActMigrationCaptureService()
    ).captureNext(parsed.data, { maxRequests: 10 });
    changedPath(result.changed);
    return interruptionError(result.progress) ?? {
      ok: true,
      changed: result.changed,
      runId: parsed.data,
      progress: result.progress,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function continueActMigrationAction(
  runId: string,
): Promise<ActMigrationProgressActionResult> {
  const actor = await requireOwner();
  void actor;
  return captureAction(runId);
}

export async function resumeActMigrationAction(
  runId: string,
): Promise<ActMigrationProgressActionResult> {
  const actor = await requireOwner();
  void actor;
  return captureAction(runId);
}

export async function finalizeActMigrationPreviewAction(input: {
  runId: string;
  query: MigrationPreviewQuery;
}): Promise<ActMigrationPreviewActionResult> {
  const actor = await requireOwner();
  void actor;
  const parsed = z.object({
    runId: uuidSchema,
    query: previewQuerySchema,
  }).strict().safeParse(input);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const result = await (
      await createActMigrationPreviewService()
    ).finalizePreview(parsed.data.runId, parsed.data.query);
    changedPath(result.changed);
    return {
      ok: true,
      changed: result.changed,
      runId: parsed.data.runId,
      preview: result.preview,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveActMigrationDecisionAction(input: {
  runId: string;
  proposalKey: string;
  decision: (typeof migrationDecisionValues)[number];
  chosenLocalEntityId?: string;
  primarySourceId?: string;
  ignoreReason?: string;
}): Promise<ActMigrationDecisionActionResult> {
  const actor = await requireOwner();
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error);
  try {
    const result = await (
      await createActMigrationPreviewService()
    ).saveDecision({ ...parsed.data, decidedBy: actor.userId });
    changedPath(result.changed);
    return {
      ok: true,
      changed: result.changed,
      runId: parsed.data.runId,
      proposalKey: parsed.data.proposalKey,
    };
  } catch (error) {
    return actionError(error);
  }
}
