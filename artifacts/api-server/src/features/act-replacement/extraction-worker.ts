import type {
  ActPage,
  ActPageRequest,
} from "@/features/act-migration/migration-types";
import { ActApiError } from "@/features/act-sync/act-errors";
import { ActAuthorizationRequiredError } from "@/features/act-sync/act-client";
import type {
  ActSourceArchiveRepository,
  ArchiveSourceItem,
} from "./archive-repository";
import type { ActReplacementCheckpointRepository } from "./checkpoint-repository";
import { planRootDerivedCheckpoints } from "./checkpoint-planner";
import type {
  ActCheckpointKind,
  ActReplacementStreamType,
  ActRootStreamType,
  ClaimedCheckpoint,
  DerivedCheckpointSpec,
} from "./import-types";
import type { ActRequestAuditRepository } from "./request-audit-repository";
import { parseRetryAfter } from "./retry-policy";
import {
  parseDetailSourceRecord,
  parseRelationshipSourceRecords,
  parseRootSourceRecords,
} from "./source-record-parser";
import { fingerprintSourceContent } from "./source-fingerprint";
import { logger } from "@/lib/logger";

type WorkerCheckpoint = Omit<ClaimedCheckpoint, "checkpointKind"> & {
  checkpointKind: ActCheckpointKind;
};

type RelationshipDescriptor = {
  parentKind: ActRootStreamType;
  targetKind: "contact" | "company" | "opportunity";
  pathTemplate: string;
};

const rootPathTemplates: Record<ActRootStreamType, string> = {
  company: "/api/companies",
  contact: "/api/contacts",
  opportunity: "/api/opportunities",
  group: "/api/groups",
  activity: "/api/activities",
  note: "/api/notes",
  history: "/api/history",
};

const relationships: Partial<
  Record<ActReplacementStreamType, RelationshipDescriptor>
> = {
  company_contact: {
    parentKind: "contact",
    targetKind: "company",
    pathTemplate: "/api/contacts/{id}/companies",
  },
  opportunity_company: {
    parentKind: "opportunity",
    targetKind: "company",
    pathTemplate: "/api/opportunities/{id}/companies",
  },
  opportunity_contact: {
    parentKind: "opportunity",
    targetKind: "contact",
    pathTemplate: "/api/opportunities/{id}/contacts",
  },
  group_contact: {
    parentKind: "group",
    targetKind: "contact",
    pathTemplate: "/api/groups/{id}/contacts",
  },
  activity_contact: {
    parentKind: "activity",
    targetKind: "contact",
    pathTemplate: "/api/activities/{id}/contacts",
  },
  activity_company: {
    parentKind: "activity",
    targetKind: "company",
    pathTemplate: "/api/activities/{id}/companies",
  },
  activity_opportunity: {
    parentKind: "activity",
    targetKind: "opportunity",
    pathTemplate: "/api/activities/{id}/opportunities",
  },
  note_contact: {
    parentKind: "note",
    targetKind: "contact",
    pathTemplate: "/api/notes/{id}/contacts",
  },
  note_company: {
    parentKind: "note",
    targetKind: "company",
    pathTemplate: "/api/notes/{id}/companies",
  },
  note_opportunity: {
    parentKind: "note",
    targetKind: "opportunity",
    pathTemplate: "/api/notes/{id}/opportunities",
  },
  history_contact: {
    parentKind: "history",
    targetKind: "contact",
    pathTemplate: "/api/history/{id}/contacts",
  },
  history_company: {
    parentKind: "history",
    targetKind: "company",
    pathTemplate: "/api/history/{id}/companies",
  },
  history_opportunity: {
    parentKind: "history",
    targetKind: "opportunity",
    pathTemplate: "/api/history/{id}/opportunities",
  },
};

export interface ActExtractionSourceClient {
  listRoot(kind: ActRootStreamType, request: ActPageRequest): Promise<ActPage>;
  listContactNotes(
    contactId: string,
    request: ActPageRequest,
  ): Promise<ActPage>;
  getDetail(
    kind: ActRootStreamType,
    id: string,
  ): Promise<Record<string, unknown>>;
  listRelationship(input: {
    streamType: ActReplacementStreamType;
    parentKind: ActRootStreamType;
    parentId: string;
    targetKind: "contact" | "company" | "opportunity";
    request: ActPageRequest;
  }): Promise<ActPage>;
}

export type ActExtractionStepResult =
  | { kind: "idle" }
  | { kind: "progress"; runId: string; checkpointId: string }
  | { kind: "retry_scheduled"; runId: string; checkpointId: string };

type Clock = { now(): Date };
export type ActExtractionAuthorization = {
  isReady(now: Date): boolean;
  authorize(): Promise<void>;
};

function isRootStream(
  value: ActReplacementStreamType,
): value is ActRootStreamType {
  return Object.prototype.hasOwnProperty.call(rootPathTemplates, value);
}

function progress(checkpoint: WorkerCheckpoint): ActExtractionStepResult {
  return {
    kind: "progress",
    runId: checkpoint.runId,
    checkpointId: checkpoint.id,
  };
}

function durationMs(startedAt: Date, completedAt: Date) {
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

function safeProcessErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "unknown";
}

function isActPage(value: unknown): value is ActPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.items) &&
    (record.nextSkip === null ||
      (typeof record.nextSkip === "number" &&
        Number.isInteger(record.nextSkip) &&
        record.nextSkip >= 0)) &&
    (record.queryMode === "projected" || record.queryMode === "plain")
  );
}

function pathTemplate(checkpoint: WorkerCheckpoint): string {
  if (checkpoint.checkpointKind === "relationship") {
    if (checkpoint.streamType === "note") {
      return "/api/contacts/{id}/notes";
    }
    const relationship = relationships[checkpoint.streamType];
    if (!relationship) throw new ActApiError("invalid_response", false);
    return relationship.pathTemplate;
  }
  if (!isRootStream(checkpoint.streamType)) {
    throw new ActApiError("invalid_response", false);
  }
  const root = rootPathTemplates[checkpoint.streamType];
  return checkpoint.checkpointKind === "detail" ? `${root}/{id}` : root;
}

export class ActExtractionWorker {
  constructor(
    private readonly dependencies: {
      checkpoints: ActReplacementCheckpointRepository;
      audits: ActRequestAuditRepository;
      source: ActExtractionSourceClient;
      archive: ActSourceArchiveRepository;
      authorization: ActExtractionAuthorization;
      clock: Clock;
    },
  ) {}

  async runOne(input: {
    workerId: string;
    now: Date;
  }): Promise<ActExtractionStepResult> {
    const claimed = await this.dependencies.checkpoints.claimNext({
      workerId: input.workerId,
      now: input.now,
      leaseMs: 60_000,
    });
    if (!claimed) return { kind: "idle" };
    const checkpoint = claimed as WorkerCheckpoint;

    if (checkpoint.checkpointKind === "list") {
      logger.info(
        {
          runId: checkpoint.runId,
          checkpointId: checkpoint.id,
          streamType: checkpoint.streamType,
          checkpointKind: checkpoint.checkpointKind,
        },
        "Act extraction root checkpoint claimed",
      );
    }

    if (!this.dependencies.authorization.isReady(input.now)) {
      return this.runAuthorizationStep(checkpoint, input.now);
    }

    let auditId: string;
    try {
      ({ auditId } = await this.dependencies.audits.begin({
        runId: checkpoint.runId,
        checkpointId: checkpoint.id,
        streamType: checkpoint.streamType,
        method: "GET",
        pathTemplate: pathTemplate(checkpoint),
        startedAt: input.now,
      }));
    } catch (error) {
      logger.error(
        {
          runId: checkpoint.runId,
          checkpointId: checkpoint.id,
          streamType: checkpoint.streamType,
          checkpointKind: checkpoint.checkpointKind,
          errorCode: safeProcessErrorCode(error),
        },
        "Act extraction audit could not be started",
      );
      return progress(checkpoint);
    }

    let fetched: ActPage | Record<string, unknown>;
    try {
      fetched = await this.fetchCheckpoint(checkpoint);
    } catch (error) {
      if (error instanceof ActAuthorizationRequiredError) {
        return this.finishAuthorizationRace({
          checkpoint,
          auditId,
          startedAt: input.now,
        });
      }
      return this.finishFailure({
        checkpoint,
        auditId,
        error,
        startedAt: input.now,
      });
    }

    if (this.isPlainProjectionFallback(checkpoint, fetched)) {
      const completedAt = this.dependencies.clock.now();
      if (!(await this.finishSuccess(auditId, input.now, completedAt))) {
        return progress(checkpoint);
      }
      try {
        await this.dependencies.checkpoints.switchToPlain({
          checkpointId: checkpoint.id,
          leaseOwner: checkpoint.leaseOwner,
          now: completedAt,
        });
      } catch {
        // The live lease is the restart boundary if fallback persistence fails.
      }
      return progress(checkpoint);
    }

    let page: ReturnType<ActExtractionWorker["parseCheckpoint"]>;
    let pageFingerprint: string;
    try {
      page = this.parseCheckpoint(checkpoint, fetched);
      pageFingerprint = fingerprintSourceContent({
        items: page.items.map(({ raw }) => raw),
      });
    } catch (error) {
      return this.finishFailure({
        checkpoint,
        auditId,
        error,
        startedAt: input.now,
      });
    }

    const completedAt = this.dependencies.clock.now();
    if (!(await this.finishSuccess(auditId, input.now, completedAt))) {
      return progress(checkpoint);
    }

    try {
      await this.dependencies.archive.archiveCheckpointPage({
        runId: checkpoint.runId,
        checkpointId: checkpoint.id,
        leaseOwner: checkpoint.leaseOwner,
        expectedSkip: checkpoint.nextSkip,
        items: page.items,
        derivedCheckpoints: page.derivedCheckpoints,
        nextSkip: page.nextSkip,
        queryMode: page.queryMode,
        pageFingerprint,
        now: completedAt,
      });
    } catch (error) {
      logger.error(
        {
          runId: checkpoint.runId,
          checkpointId: checkpoint.id,
          streamType: checkpoint.streamType,
          checkpointKind: checkpoint.checkpointKind,
          errorCode: safeProcessErrorCode(error),
        },
        "Act extraction page could not be archived",
      );
      // The lease and archive transaction are the restart boundary. A storage
      // failure leaves the leased checkpoint recoverable.
    }
    return progress(checkpoint);
  }

  private async runAuthorizationStep(
    checkpoint: WorkerCheckpoint,
    startedAt: Date,
  ): Promise<ActExtractionStepResult> {
    let auditId: string;
    try {
      ({ auditId } = await this.dependencies.audits.begin({
        runId: checkpoint.runId,
        checkpointId: checkpoint.id,
        streamType: checkpoint.streamType,
        method: "GET",
        pathTemplate: "/authorize",
        startedAt,
      }));
    } catch {
      return progress(checkpoint);
    }

    try {
      await this.dependencies.authorization.authorize();
    } catch (error) {
      return this.finishFailure({ checkpoint, auditId, error, startedAt });
    }

    const completedAt = this.dependencies.clock.now();
    if (!(await this.finishSuccess(auditId, startedAt, completedAt))) {
      return progress(checkpoint);
    }
    await this.releaseAuthorizationClaim(checkpoint, completedAt);
    return progress(checkpoint);
  }

  private async finishAuthorizationRace(input: {
    checkpoint: WorkerCheckpoint;
    auditId: string;
    startedAt: Date;
  }): Promise<ActExtractionStepResult> {
    const completedAt = this.dependencies.clock.now();
    try {
      await this.dependencies.audits.finish({
        auditId: input.auditId,
        state: "failed",
        httpStatus: null,
        safeErrorCode: "authentication_failed",
        durationMs: durationMs(input.startedAt, completedAt),
        completedAt,
      });
    } catch {
      return progress(input.checkpoint);
    }
    await this.releaseAuthorizationClaim(input.checkpoint, completedAt);
    return progress(input.checkpoint);
  }

  private async releaseAuthorizationClaim(
    checkpoint: WorkerCheckpoint,
    now: Date,
  ) {
    try {
      await this.dependencies.checkpoints.releaseForAuthorization({
        checkpointId: checkpoint.id,
        leaseOwner: checkpoint.leaseOwner,
        now,
      });
    } catch {
      // Lease expiry preserves restart safety if the requeue transaction fails.
    }
  }

  private async finishSuccess(
    auditId: string,
    startedAt: Date,
    completedAt: Date,
  ) {
    try {
      await this.dependencies.audits.finish({
        auditId,
        state: "succeeded",
        httpStatus: null,
        safeErrorCode: null,
        durationMs: durationMs(startedAt, completedAt),
        completedAt,
      });
      return true;
    } catch {
      return false;
    }
  }

  private fetchCheckpoint(
    checkpoint: WorkerCheckpoint,
  ): Promise<ActPage | Record<string, unknown>> {
    if (checkpoint.checkpointKind === "relationship") {
      if (checkpoint.streamType === "note") {
        if (!checkpoint.parentActRecordId) {
          throw new ActApiError("invalid_response", false);
        }
        return this.dependencies.source.listContactNotes(
          checkpoint.parentActRecordId,
          {
            skip: checkpoint.nextSkip,
            top: checkpoint.pageSize,
            queryMode: checkpoint.queryMode,
          },
        );
      }
      const relationship = relationships[checkpoint.streamType];
      if (!relationship || !checkpoint.parentActRecordId) {
        throw new ActApiError("invalid_response", false);
      }
      return this.dependencies.source.listRelationship({
        streamType: checkpoint.streamType,
        parentKind: relationship.parentKind,
        parentId: checkpoint.parentActRecordId,
        targetKind: relationship.targetKind,
        request: {
          skip: checkpoint.nextSkip,
          top: checkpoint.pageSize,
          queryMode: checkpoint.queryMode,
        },
      });
    }
    if (!isRootStream(checkpoint.streamType)) {
      throw new ActApiError("invalid_response", false);
    }
    if (checkpoint.checkpointKind === "detail") {
      if (!checkpoint.parentActRecordId) {
        throw new ActApiError("invalid_response", false);
      }
      return this.dependencies.source.getDetail(
        checkpoint.streamType,
        checkpoint.parentActRecordId,
      );
    }
    return this.dependencies.source.listRoot(checkpoint.streamType, {
      skip: checkpoint.nextSkip,
      top: checkpoint.pageSize,
      queryMode: checkpoint.queryMode,
    });
  }

  private isPlainProjectionFallback(
    checkpoint: WorkerCheckpoint,
    fetched: ActPage | Record<string, unknown>,
  ): fetched is ActPage {
    return (
      checkpoint.checkpointKind === "list" &&
      checkpoint.queryMode === "projected" &&
      isActPage(fetched) &&
      fetched.items.length === 0 &&
      fetched.queryMode === "plain" &&
      fetched.nextSkip === checkpoint.nextSkip
    );
  }

  private parseCheckpoint(
    checkpoint: WorkerCheckpoint,
    fetched: ActPage | Record<string, unknown>,
  ): {
    items: ArchiveSourceItem[];
    derivedCheckpoints: DerivedCheckpointSpec[];
    nextSkip: number | null;
    queryMode: WorkerCheckpoint["queryMode"];
  } {
    if (checkpoint.checkpointKind === "relationship") {
      if (checkpoint.streamType === "note") {
        if (!checkpoint.parentActRecordId || !isActPage(fetched)) {
          throw new ActApiError("invalid_response", false);
        }
        const items = parseRootSourceRecords({
          streamType: "note",
          records: fetched.items,
          queryMode: fetched.queryMode,
        }).map((item) => ({
          ...item,
          relationshipEvidence: {
            source: "endpoint",
            parentKind: "note",
            parentActRecordId: item.actRecordId,
            targetKind: "contact",
            targetActRecordId: checkpoint.parentActRecordId,
          },
        }));
        return {
          items,
          derivedCheckpoints: [],
          nextSkip: fetched.nextSkip,
          queryMode: fetched.queryMode,
        };
      }
      const relationship = relationships[checkpoint.streamType];
      if (
        !relationship ||
        !checkpoint.parentActRecordId ||
        !isActPage(fetched)
      ) {
        throw new ActApiError("invalid_response", false);
      }
      return {
        items: parseRelationshipSourceRecords({
          streamType: checkpoint.streamType,
          parentKind: relationship.parentKind,
          parentId: checkpoint.parentActRecordId,
          targetKind: relationship.targetKind,
          records: fetched.items,
        }),
        derivedCheckpoints: [],
        nextSkip: fetched.nextSkip,
        queryMode: fetched.queryMode,
      };
    }
    if (!isRootStream(checkpoint.streamType)) {
      throw new ActApiError("invalid_response", false);
    }
    if (checkpoint.checkpointKind === "detail") {
      if (!checkpoint.parentActRecordId || "items" in fetched) {
        throw new ActApiError("invalid_response", false);
      }
      const item = parseDetailSourceRecord({
        streamType: checkpoint.streamType,
        requestedId: checkpoint.parentActRecordId,
        record: fetched,
      });
      return {
        items: [item],
        derivedCheckpoints: planRootDerivedCheckpoints({
          rootStream: checkpoint.streamType,
          items: [item],
          pageSize: checkpoint.pageSize,
          queryMode: "plain",
          deriveDetails: false,
        }),
        nextSkip: null,
        queryMode: "plain",
      };
    }
    if (!isActPage(fetched)) throw new ActApiError("invalid_response", false);
    const items = parseRootSourceRecords({
      streamType: checkpoint.streamType,
      records: fetched.items,
      queryMode: fetched.queryMode,
    });
    return {
      items,
      derivedCheckpoints: planRootDerivedCheckpoints({
        rootStream: checkpoint.streamType,
        items,
        pageSize: checkpoint.pageSize,
        queryMode: fetched.queryMode,
        deriveDetails: checkpoint.deriveDetails,
      }),
      nextSkip: fetched.nextSkip,
      queryMode: fetched.queryMode,
    };
  }

  private async finishFailure(input: {
    checkpoint: WorkerCheckpoint;
    auditId: string;
    error: unknown;
    startedAt: Date;
  }): Promise<ActExtractionStepResult> {
    const error =
      input.error instanceof ActApiError
        ? input.error
        : new ActApiError("invalid_response", false);
    logger.warn(
      {
        streamType: input.checkpoint.streamType,
        checkpointKind: input.checkpoint.checkpointKind,
        errorCode: error.code,
        retryable: error.retryable,
      },
      "Act extraction request failed",
    );
    const completedAt = this.dependencies.clock.now();
    try {
      await this.dependencies.audits.finish({
        auditId: input.auditId,
        state: "failed",
        httpStatus: null,
        safeErrorCode: error.code,
        durationMs: durationMs(input.startedAt, completedAt),
        completedAt,
      });
    } catch {
      return progress(input.checkpoint);
    }

    const failure = {
      checkpointId: input.checkpoint.id,
      leaseOwner: input.checkpoint.leaseOwner,
      errorCode: error.code,
      retryable: error.retryable,
      retryAfter: parseRetryAfter(error.retryAfter, input.startedAt),
      now: completedAt,
    };
    try {
      if (error.retryable) {
        await this.dependencies.checkpoints.scheduleRetry(failure);
        return {
          kind: "retry_scheduled",
          runId: input.checkpoint.runId,
          checkpointId: input.checkpoint.id,
        };
      }
      if (
        error.code === "query_rejected" &&
        input.checkpoint.checkpointKind === "list" &&
        input.checkpoint.queryMode === "projected" &&
        input.checkpoint.nextSkip === 0
      ) {
        await this.dependencies.checkpoints.switchToPlain({
          checkpointId: input.checkpoint.id,
          leaseOwner: input.checkpoint.leaseOwner,
          now: completedAt,
        });
      } else if (
        error.code === "endpoint_unsupported" &&
        input.checkpoint.checkpointKind === "detail" &&
        isRootStream(input.checkpoint.streamType)
      ) {
        await this.dependencies.checkpoints.markDetailCapabilityUnavailable({
          runId: input.checkpoint.runId,
          checkpointId: input.checkpoint.id,
          leaseOwner: input.checkpoint.leaseOwner,
          rootStream: input.checkpoint.streamType,
          now: completedAt,
        });
      } else if (
        input.checkpoint.requiredness === "optional_capability" &&
        (error.code === "endpoint_unsupported" || error.code === "not_found")
      ) {
        await this.dependencies.checkpoints.markUnsupported(failure);
      } else {
        await this.dependencies.checkpoints.markFailed(failure);
      }
    } catch {
      // A still-live lease prevents another worker from duplicating the GET;
      // expiry provides the restart path if checkpoint persistence failed.
    }
    return progress(input.checkpoint);
  }
}
