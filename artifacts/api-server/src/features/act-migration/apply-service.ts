import { randomUUID } from "node:crypto";

import { ACT_MIGRATION_APPLY_BATCH_SIZE } from "@/features/act-migration/action-limits";
import type {
  ActMigrationApplyRepository,
  MigrationApplyCounts,
  MigrationApplyOperation,
  MigrationApplyWorkspace,
} from "@/features/act-migration/apply-repository";
import type { MigrationApplyManifest } from "@/features/act-migration/apply-types";
import type { MigrationTargetEntityType } from "@/features/act-migration/migration-types";

export type ActMigrationApplyTargetResult = {
  entityId: string;
  changed: boolean;
  wasCreated: boolean;
};

export interface ActMigrationApplyTarget {
  apply(operation: MigrationApplyOperation): Promise<ActMigrationApplyTargetResult>;
}

export type ActMigrationApplyResult = {
  runId: string;
  batchId: string;
  changed: boolean;
  counts: MigrationApplyCounts;
  retryable: boolean;
  retryAfter: string | null;
  errorCode: string | null;
};

type ApplyFailure = {
  errorCode: string;
  retryable: boolean;
  retryAfter: string | null;
};

const SAFE_ERROR_CODE = /^[a-z0-9_:-]{1,120}$/;

export class ActMigrationApplyError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfter: string | null = null,
  ) {
    super("Act migration apply operation failed.");
    this.name = "ActMigrationApplyError";
  }
}

function failure(error: unknown): ApplyFailure {
  if (error instanceof ActMigrationApplyError) {
    return {
      errorCode: SAFE_ERROR_CODE.test(error.code) ? error.code : "unknown",
      retryable: error.retryable,
      retryAfter: error.retryAfter,
    };
  }
  return { errorCode: "unknown", retryable: false, retryAfter: null };
}

function batchCounts(workspace: MigrationApplyWorkspace, batchId: string) {
  return workspace.batches.find(({ id }) => id === batchId)?.summary ?? workspace.counts;
}

export class ActMigrationApplyService {
  constructor(
    private readonly repository: ActMigrationApplyRepository,
    private readonly targets: Partial<
      Record<MigrationTargetEntityType, ActMigrationApplyTarget>
    >,
  ) {}

  async start(input: {
    requestKey: string;
    runId: string;
    requestedBy: string;
    manifest?: MigrationApplyManifest;
  }): Promise<ActMigrationApplyResult> {
    const batch = await this.repository.createBatchIfAbsent({
      ...input,
      now: new Date(),
    });
    return {
      runId: input.runId,
      batchId: batch.id,
      changed: batch.created,
      counts: batch.summary,
      retryable: false,
      retryAfter: null,
      errorCode: null,
    };
  }

  continue(input: { runId: string; batchId: string }) {
    return this.process(input);
  }

  async retry(input: { runId: string; batchId: string }) {
    return this.process(input);
  }

  private async process(input: {
    runId: string;
    batchId: string;
  }): Promise<ActMigrationApplyResult> {
    const initialWorkspace = await this.repository.getApplyWorkspace(input.runId);
    if (!initialWorkspace.batches.some(({ id }) => id === input.batchId)) {
      throw new ActMigrationApplyError("batch_not_found", false);
    }

    const leaseOwner = randomUUID();
    let changed = false;
    let applyFailure: ApplyFailure | null = null;
    await this.repository.releaseExpiredLeases(input.batchId, new Date());

    for (let index = 0; index < ACT_MIGRATION_APPLY_BATCH_SIZE; index += 1) {
      const operation = await this.repository.claimNextOperation(
        input.batchId,
        leaseOwner,
        new Date(),
      );
      if (!operation) break;

      const target = this.targets[operation.targetEntityType];
      if (!target) {
        applyFailure = {
          errorCode: "unsupported_target",
          retryable: false,
          retryAfter: null,
        };
        await this.repository.failOperation({
          operationId: operation.id,
          leaseOwner,
          errorCode: applyFailure.errorCode,
          retryable: false,
          now: new Date(),
        });
        break;
      }

      let applied: ActMigrationApplyTargetResult;
      try {
        applied = await target.apply(operation);
      } catch (error) {
        applyFailure = failure(error);
        await this.repository.failOperation({
          operationId: operation.id,
          leaseOwner,
          errorCode: applyFailure.errorCode,
          retryable: applyFailure.retryable,
          now: new Date(),
        });
        break;
      }

      changed ||= applied.changed;
      try {
        await this.repository.completeOperation({
          operationId: operation.id,
          leaseOwner,
          entityId: applied.entityId,
          wasCreated: applied.wasCreated,
          now: new Date(),
        });
      } catch {
        applyFailure = {
          errorCode: "queue_completion_failed",
          retryable: true,
          retryAfter: null,
        };
        break;
      }
    }

    const workspace = await this.repository.getApplyWorkspace(input.runId);
    return {
      runId: input.runId,
      batchId: input.batchId,
      changed,
      counts: batchCounts(workspace, input.batchId),
      retryable: applyFailure?.retryable ?? false,
      retryAfter: applyFailure?.retryAfter ?? null,
      errorCode: applyFailure?.errorCode ?? null,
    };
  }
}
