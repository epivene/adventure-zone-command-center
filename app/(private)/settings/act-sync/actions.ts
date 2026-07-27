"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ActClient } from "@/features/act-sync/act-client";
import { ActApiError } from "@/features/act-sync/act-errors";
import {
  createDefaultActSyncService,
  type SyncApplyDecision,
  type SyncApplyRowResult,
} from "@/features/act-sync/sync-service";
import { syncDecisionValues } from "@/features/act-sync/sync-comparison";
import { requireOwner } from "@/lib/auth/require-owner";
import { getActEnvironment } from "@/lib/env";

export type ActSyncActionResult =
  | { ok: true; runId: string }
  | { ok: false; error: string };

export type ActSyncApplyActionResult =
  | {
      ok: true;
      result: { runId: string; rows: SyncApplyRowResult[] };
    }
  | { ok: false; error: string };

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
    .min(1),
});

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

export async function applyActSyncAction(
  runId: string,
  decisions: readonly SyncApplyDecision[],
): Promise<ActSyncApplyActionResult> {
  await requireOwner();
  const parsed = applyInputSchema.safeParse({ runId, decisions });
  if (!parsed.success) {
    return { ok: false, error: "Choose valid sync decisions." };
  }
  try {
    const result = await (
      await createDefaultActSyncService()
    ).apply(parsed.data.runId, parsed.data.decisions);
    revalidatePath("/contacts");
    revalidatePath("/settings/act-sync");
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: safeError(error, "The approved Act! changes could not be applied."),
    };
  }
}
