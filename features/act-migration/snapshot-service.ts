import { randomUUID } from "node:crypto";

import { ActApiError } from "@/features/act-sync/act-errors";
import type {
  ActMigrationCheckpoint,
  ActMigrationSnapshotRepository,
  SnapshotProgress,
} from "@/features/act-migration/snapshot-repository";
import type {
  ActMigrationStreamType,
  ActPage,
} from "@/features/act-migration/migration-types";
import type { ActMigrationSourceClient } from "@/features/act-migration/source-client";
import {
  parseSourceItem,
  type StagedSourceItem,
} from "@/features/act-migration/source-parser";

function retryAfterDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function relationshipInput(
  checkpoint: ActMigrationCheckpoint,
  item: unknown,
): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const record = item as Record<string, unknown>;
  switch (checkpoint.streamType) {
    case "company_contact":
      return {
        ...record,
        sourceId: record.id,
        targetSourceId: checkpoint.parentSourceId,
      };
    case "opportunity_company":
    case "opportunity_contact":
    case "group_contact":
      return {
        ...record,
        sourceId: checkpoint.parentSourceId,
        targetSourceId: record.id,
      };
    default:
      return record;
  }
}

function stagedItem(
  streamType: ActMigrationStreamType,
  item: unknown,
): StagedSourceItem {
  const parsed = parseSourceItem(
    streamType,
    item as Record<string, unknown>,
  );
  if (!parsed.ok) {
    return {
      streamType,
      sourceKey: parsed.deterministicErrorKey,
      sourceId: null,
      targetSourceId: null,
      rawSnapshot: parsed.rawSnapshot,
      normalizedSnapshot: {},
      fingerprint: parsed.deterministicErrorKey,
      errorCode: parsed.errorCode,
      errorFields: parsed.errorFields,
    };
  }
  const normalized = parsed.normalized as Record<string, unknown>;
  return {
    streamType,
    sourceKey: parsed.sourceKey,
    sourceId: parsed.sourceId,
    targetSourceId:
      "targetSourceId" in normalized &&
      typeof normalized.targetSourceId === "string"
        ? normalized.targetSourceId
        : null,
    rawSnapshot: parsed.rawSnapshot,
    normalizedSnapshot: normalized,
    fingerprint: parsed.fingerprint,
    errorCode: null,
    errorFields: [],
  };
}

export class ActMigrationSnapshotService {
  constructor(
    private readonly client: ActMigrationSourceClient,
    private readonly repository: ActMigrationSnapshotRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(input: {
    requestKey: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }) {
    return this.repository.createRun(input);
  }

  async captureNext(
    runId: string,
    options: { maxRequests?: number } = {},
  ): Promise<SnapshotProgress> {
    const maxRequests = Math.min(
      10,
      Math.max(1, options.maxRequests ?? 10),
    );
    for (let request = 0; request < maxRequests; request += 1) {
      const leaseOwner = randomUUID();
      const checkpoint = await this.repository.claimNextCheckpoint(
        runId,
        leaseOwner,
        this.now(),
      );
      if (!checkpoint) break;
      await this.captureCheckpointPage(checkpoint, leaseOwner);
    }
    return this.repository.getProgress(runId);
  }

  private async captureCheckpointPage(
    checkpoint: ActMigrationCheckpoint,
    leaseOwner: string,
  ) {
    try {
      const page = await this.fetchPage(checkpoint);
      const records = page.items.map((item) =>
        stagedItem(
          checkpoint.streamType,
          relationshipInput(checkpoint, item),
        )
      );
      await this.repository.storePage({
        checkpointId: checkpoint.id,
        leaseOwner,
        expectedSkip: checkpoint.nextSkip,
        records,
        nextSkip: page.nextSkip,
        queryMode: page.queryMode,
        now: this.now(),
      });
      await this.repository.enqueueRelationshipCheckpoints(checkpoint.runId);
    } catch (error) {
      if (!(error instanceof ActApiError)) throw error;
      await this.repository.failCheckpoint({
        checkpointId: checkpoint.id,
        leaseOwner,
        errorCode: error.code,
        retryable: error.retryable,
        retryAfter: retryAfterDate(error.retryAfter),
        now: this.now(),
      });
    }
  }

  private fetchPage(checkpoint: ActMigrationCheckpoint): Promise<ActPage> {
    const request = {
      skip: checkpoint.nextSkip,
      top: checkpoint.pageSize,
      queryMode: checkpoint.queryMode,
    };
    switch (checkpoint.streamType) {
      case "company":
        return this.client.listCompanies(request);
      case "contact":
        return this.client.listContacts(request);
      case "opportunity":
        return this.client.listOpportunities(request);
      case "group":
        return this.client.listGroups(request);
      case "company_contact":
        return this.client.listCompaniesForContact(
          this.parentSourceId(checkpoint),
          request,
        );
      case "opportunity_company":
        return this.client.listCompaniesForOpportunity(
          this.parentSourceId(checkpoint),
          request,
        );
      case "opportunity_contact":
        return this.client.listContactsForOpportunity(
          this.parentSourceId(checkpoint),
          request,
        );
      case "group_contact":
        return this.client.listContactsForGroup(
          this.parentSourceId(checkpoint),
          request,
        );
    }
  }

  private parentSourceId(checkpoint: ActMigrationCheckpoint) {
    if (!checkpoint.parentSourceId) {
      throw new Error("Relationship checkpoint parent is missing.");
    }
    return checkpoint.parentSourceId;
  }
}
