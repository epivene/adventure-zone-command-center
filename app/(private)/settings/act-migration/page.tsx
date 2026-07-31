import { z } from "zod";

import { ActMigrationReview } from "@/components/act-migration/act-migration-review";
import { ACT_MIGRATION_PREVIEW_MAX_PAGE } from "@/features/act-migration/action-limits";
import {
  isMigrationTargetEntityType,
  migrationPreviewStateValues,
  type MigrationPreviewState,
} from "@/features/act-migration/migration-types";
import type { MigrationPreviewQuery } from "@/features/act-migration/preview-repository";
import { createActMigrationWorkspaceReader } from "@/features/act-migration/runtime";
import { requireOwner } from "@/lib/auth/require-owner";
import { getActEnvironment, isActMigrationApplyEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : fallback;
}

function isPreviewState(value: unknown): value is MigrationPreviewState {
  return (
    typeof value === "string" &&
    (migrationPreviewStateValues as readonly string[]).includes(value)
  );
}

function previewQuery(
  params: Record<string, string | string[] | undefined>,
): MigrationPreviewQuery {
  const targetEntityType = firstValue(params.targetEntityType);
  const state = firstValue(params.state);
  return {
    page: boundedInteger(
      firstValue(params.page),
      1,
      ACT_MIGRATION_PREVIEW_MAX_PAGE,
    ),
    pageSize: boundedInteger(firstValue(params.pageSize), 50, 100),
    ...(isMigrationTargetEntityType(targetEntityType)
      ? { targetEntityType }
      : {}),
    ...(isPreviewState(state) ? { state } : {}),
  };
}

function maskDatabase(databaseName: string) {
  const normalized = databaseName.trim();
  if (normalized.length <= 4) {
    return "•".repeat(4);
  }
  const visible = normalized.slice(-4);
  return `${"•".repeat(Math.max(4, normalized.length - visible.length))}${visible}`;
}

export default async function ActMigrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();

  let configured = false;
  let maskedDatabase: string | null = null;
  try {
    const environment = getActEnvironment();
    configured = environment.configured;
    maskedDatabase = environment.configured
      ? maskDatabase(environment.config.databaseName)
      : null;
  } catch {
    configured = false;
  }

  const params = await searchParams;
  const candidateRunId = firstValue(params.runId);
  const runId = z.uuid().safeParse(candidateRunId).success
    ? candidateRunId
    : undefined;
  const query = previewQuery(params);
  const reader = await createActMigrationWorkspaceReader();
  const workspace = await reader.getWorkspace({ runId, query });
  const version = workspace
    ? [
        workspace.progress.runId,
        workspace.progress.status,
        workspace.progress.completedCheckpoints,
        workspace.progress.totalCheckpoints,
        workspace.progress.stagedRecords,
        workspace.progress.failedCheckpoints,
        workspace.progress.interruption?.code ?? "",
        workspace.progress.interruption?.retryAfter?.getTime() ?? "",
        ...(workspace.preview?.rows.map((row) =>
          `${row.proposalKey}:${row.decision ?? ""}:${
            row.decidedAt?.getTime() ?? ""
          }`
        ) ?? []),
      ].join("|")
    : "no-run";

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Act! migration
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Stage a durable Act! snapshot, inspect every reconciliation issue,
          and save review decisions without changing either system.
        </p>
      </header>

      <ActMigrationReview
        applyEnabled={isActMigrationApplyEnabled()}
        configured={configured}
        key={version}
        maskedDatabase={maskedDatabase}
        query={query}
        workspace={workspace}
      />
    </div>
  );
}
