"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ActClient } from "@/features/act-sync/act-client";
import { ActApiError } from "@/features/act-sync/act-errors";
import {
  ACT_SYNC_BATCH_SIZE,
} from "@/features/act-sync/apply-decisions-in-batches";
import {
  ActSyncInterruptedError,
  ActSyncQueueChangedError,
  createDefaultActSyncService,
  type SyncApplyDecision,
  type SyncApplyRowResult,
} from "@/features/act-sync/sync-service";
import { syncDecisionValues } from "@/features/act-sync/sync-comparison";
import { requireOwner } from "@/lib/auth/require-owner";
import { getActEnvironment } from "@/lib/env";

export type ActSyncActionResult =
  | { ok: true; runId: string; queueToken?: string }
  | { ok: false; error: string };

export type ActSyncApplyActionResult =
  | {
      ok: true;
      result: { runId: string; rows: SyncApplyRowResult[] };
    }
  | {
      ok: false;
      error: string;
      interruptedRow?: SyncApplyRowResult;
      processedRows?: SyncApplyRowResult[];
    };

const applyInputSchema = z.object({
  runId: z.string().trim().min(1),
  decisions: z
    .array(
      z.object({
        rowId: z.string().trim().min(1),
        decision: z.enum(syncDecisionValues),
        localContactId: z.string().trim().min(1).optional(),
      }),
    )
    .min(1)
    .max(ACT_SYNC_BATCH_SIZE),
});
const runIdSchema = z.string().trim().min(1);
const queueTokenSchema = z.uuid().optional();

function safeError(error: unknown, fallback: string) {
  return error instanceof ActApiError ? error.message : fallback;
}

export async function testActConnectionAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  await requireOwner();
  try {
    const environment = getActEnvironment();
    if (!environment.configured) {
      return { ok: false, error: "Act! connection is not configured." };
    }
    await new ActClient(environment.config).testConnection();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: safeError(error, "Act! connection could not be tested."),
    };
  }
}

export async function createActSyncPreviewAction(): Promise<ActSyncActionResult> {
  await requireOwner();
  try {
    const preview = await (await createDefaultActSyncService()).createPreview();
    return { ok: true, runId: preview.id };
  } catch (error) {
    return {
      ok: false,
      error: safeError(error, "The Act! sync preview could not be created."),
    };
  }
}

export async function stageActSyncDecisionsAction(
  runId: string,
  decisions: readonly SyncApplyDecision[],
  replaceExisting = false,
  queueToken?: string,
): Promise<ActSyncActionResult> {
  await requireOwner();
  const parsed = applyInputSchema
    .extend({
      replaceExisting: z.boolean(),
      queueToken: queueTokenSchema,
    })
    .safeParse({ runId, decisions, replaceExisting, queueToken });
  if (!parsed.success) {
    return {
      ok: false,
      error: `Save at most ${ACT_SYNC_BATCH_SIZE} valid sync decisions at a time.`,
    };
  }
  try {
    const staged = await (
      await createDefaultActSyncService()
    ).stage(
      parsed.data.runId,
      parsed.data.decisions,
      parsed.data.replaceExisting,
      parsed.data.queueToken,
    );
    return {
      ok: true,
      runId: staged.runId,
      ...(staged.queueToken ? { queueToken: staged.queueToken } : {}),
    };
  } catch {
    return {
      ok: false,
      error: "The approved sync decisions could not be saved.",
    };
  }
}

export async function clearActSyncStagedDecisionsAction(
  runId: string,
  queueToken?: string,
): Promise<ActSyncActionResult> {
  await requireOwner();
  const parsedRunId = runIdSchema.safeParse(runId);
  const parsedQueueToken = queueTokenSchema.safeParse(queueToken);
  if (!parsedRunId.success || !parsedQueueToken.success) {
    return { ok: false, error: "Choose a valid Act! sync preview." };
  }
  try {
    const cleared = await (
      await createDefaultActSyncService()
    ).clearStaged(parsedRunId.data, parsedQueueToken.data);
    return { ok: true, runId: cleared.runId };
  } catch {
    return {
      ok: false,
      error: "The saved sync decisions could not be cleared.",
    };
  }
}

export async function applyActSyncAction(
  runId: string,
  decisions: readonly SyncApplyDecision[],
  queueToken?: string,
): Promise<ActSyncApplyActionResult> {
  await requireOwner();
  if (decisions.length > ACT_SYNC_BATCH_SIZE) {
    return {
      ok: false,
      error: `Apply at most ${ACT_SYNC_BATCH_SIZE} sync decisions at a time.`,
    };
  }
  const parsed = applyInputSchema
    .extend({ queueToken: queueTokenSchema })
    .safeParse({ runId, decisions, queueToken });
  if (!parsed.success) {
    return { ok: false, error: "Choose valid sync decisions." };
  }
  try {
    const result = await (
      await createDefaultActSyncService()
    ).apply(
      parsed.data.runId,
      parsed.data.decisions,
      parsed.data.queueToken,
    );
    revalidatePath("/contacts");
    revalidatePath("/settings/act-sync");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ActSyncInterruptedError) {
      return {
        ok: false,
        error: error.message,
        interruptedRow: error.row,
        processedRows: error.processedRows,
      };
    }
    if (error instanceof ActSyncQueueChangedError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: safeError(error, "The approved Act! changes could not be applied."),
    };
  }
}
