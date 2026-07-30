import { createHash, randomUUID } from "node:crypto";

import { ActApiError } from "@/features/act-sync/act-errors";
import type {
  ActMigrationCheckpoint,
  ActMigrationSnapshotRepository,
  SnapshotProgress,
} from "@/features/act-migration/snapshot-repository";
import {
  actSourceEntityTypeValues,
  type ActPage,
} from "@/features/act-migration/migration-types";
import type { ActMigrationSourceClient } from "@/features/act-migration/source-client";
import {
  parseSourceItem,
  type StagedSourceItem,
} from "@/features/act-migration/source-parser";

function retryAfterDate(value: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    const milliseconds = seconds * 1_000;
    if (
      !Number.isSafeInteger(seconds) ||
      !Number.isSafeInteger(milliseconds)
    ) {
      return null;
    }
    const parsedEpoch = new Date(milliseconds);
    return Number.isNaN(parsedEpoch.getTime()) ? null : parsedEpoch;
  }
  const parsed = new Date(normalized);
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
  checkpoint: ActMigrationCheckpoint,
  item: unknown,
  itemIndex: number,
): StagedSourceItem {
  const streamType = checkpoint.streamType;
  const parsed = parseSourceItem(
    streamType,
    item as Record<string, unknown>,
  );
  if (!parsed.ok) {
    const occurrenceHash = createHash("sha256")
      .update(JSON.stringify([
        checkpoint.partitionKey,
        checkpoint.nextSkip,
        itemIndex,
        parsed.deterministicErrorKey,
      ]))
      .digest("hex");
    const knownSourceId =
      streamType === "opportunity_company" ||
      streamType === "opportunity_contact" ||
      streamType === "group_contact"
        ? checkpoint.parentSourceId
        : null;
    const knownTargetSourceId = streamType === "company_contact"
      ? checkpoint.parentSourceId
      : null;
    return {
      streamType,
      sourceKey: `error:${streamType}:occurrence:${occurrenceHash}`,
      sourceId: knownSourceId,
      targetSourceId: knownTargetSourceId,
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

  async start(input: {
    requestKey: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }) {
    const run = await this.repository.createRun(input);
    return {
      ...run,
      progress: await this.repository.getProgress(run.id),
    };
  }

  async captureNext(
    runId: string,
    options: { maxRequests?: number } = {},
  ): Promise<{ progress: SnapshotProgress; changed: boolean }> {
    const maxRequests = Math.min(
      10,
      Math.max(1, options.maxRequests ?? 10),
    );
    await this.repository.getProgress(runId);
    await this.repository.enqueueRelationshipCheckpoints(runId);
    let changed = false;
    for (let request = 0; request < maxRequests; request += 1) {
      const leaseOwner = randomUUID();
      const checkpoint = await this.repository.claimNextCheckpoint(
        runId,
        leaseOwner,
        this.now(),
      );
      if (!checkpoint) break;
      changed = true;
      const result = await this.captureCheckpointPage(checkpoint, leaseOwner);
      if (result === "api_failed") break;
    }
    return {
      progress: await this.repository.getProgress(runId),
      changed,
    };
  }

  private async captureCheckpointPage(
    checkpoint: ActMigrationCheckpoint,
    leaseOwner: string,
  ): Promise<"stored" | "api_failed"> {
    try {
      const page = await this.fetchPage(checkpoint);
      const records = page.items.map((item, itemIndex) =>
        stagedItem(
          checkpoint,
          relationshipInput(checkpoint, item),
          itemIndex,
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
      if (
        page.nextSkip === null &&
        actSourceEntityTypeValues.some(
          (streamType) => streamType === checkpoint.streamType,
        )
      ) {
        await this.repository.enqueueRelationshipCheckpoints(checkpoint.runId);
      }
      return "stored";
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
      return "api_failed";
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
