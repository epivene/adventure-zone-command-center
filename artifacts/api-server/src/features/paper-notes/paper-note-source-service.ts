import { and, eq, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  paperNoteBatches,
  paperNoteEntries,
  paperNotePages,
} from "@/db/schema";
import type { PaperNoteObjectStorage } from "./paper-note-object-storage";
import { firstQueryRow } from "./paper-note-query-rows";

export type PaperNoteSourceKind = "original" | "analysis";

export type PaperNoteResolvedSource = {
  batchId: string;
  pageId: string;
  originalObjectKey: string | null;
  analysisObjectKey: string | null;
};

function isPaperNoteResolvedSource(row: Record<string, unknown>): row is PaperNoteResolvedSource {
  return typeof row.batchId === "string"
    && typeof row.pageId === "string"
    && (row.originalObjectKey === null || typeof row.originalObjectKey === "string")
    && (row.analysisObjectKey === null || typeof row.analysisObjectKey === "string");
}

export interface PaperNoteSourceResolver {
  resolvePage(
    createdBy: string,
    batchId: string,
    pageId: string,
  ): Promise<PaperNoteResolvedSource | null>;
  resolveEntry(
    createdBy: string,
    entryId: string,
  ): Promise<PaperNoteResolvedSource | null>;
  resolveActivity(
    createdBy: string,
    activityId: string,
  ): Promise<PaperNoteResolvedSource | null>;
}

export class PaperNoteSourceError extends Error {
  constructor(
    public readonly code: "SOURCE_NOT_FOUND" | "SOURCE_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteSourceError";
  }
}

type SourceStorage = Pick<PaperNoteObjectStorage, "exists" | "signedReadUrl">;

export class PaperNoteSourceService {
  constructor(
    private readonly resolver: PaperNoteSourceResolver,
    private readonly storage: SourceStorage,
  ) {}

  async pageUrl(
    createdBy: string,
    batchId: string,
    pageId: string,
    kind: PaperNoteSourceKind,
  ) {
    const source = await this.resolver.resolvePage(createdBy, batchId, pageId);
    return this.sign(source, kind);
  }

  async entryUrl(
    createdBy: string,
    entryId: string,
    kind: PaperNoteSourceKind,
  ) {
    const source = await this.resolver.resolveEntry(createdBy, entryId);
    return this.sign(source, kind);
  }

  async activityUrl(
    createdBy: string,
    activityId: string,
    kind: PaperNoteSourceKind,
  ) {
    const source = await this.resolver.resolveActivity(createdBy, activityId);
    return this.sign(source, kind);
  }

  private async sign(source: PaperNoteResolvedSource | null, kind: PaperNoteSourceKind) {
    if (!source) {
      throw new PaperNoteSourceError(
        "SOURCE_NOT_FOUND",
        "Paper-note source was not found.",
      );
    }
    const key = kind === "analysis"
      ? source.analysisObjectKey ?? source.originalObjectKey
      : source.originalObjectKey;
    if (!key || !(await this.storage.exists(key))) {
      throw new PaperNoteSourceError(
        "SOURCE_MISSING",
        "The original paper photo is missing and must be restored before it can be viewed or imported.",
      );
    }
    return {
      url: await this.storage.signedReadUrl(key, 900),
      kind,
    };
  }
}

type DrizzleDatabase = typeof database;

export class DrizzlePaperNoteSourceResolver implements PaperNoteSourceResolver {
  constructor(private readonly database: DrizzleDatabase) {}

  async resolvePage(createdBy: string, batchId: string, pageId: string) {
    const [row] = await this.database.select({
      batchId: paperNotePages.batchId,
      pageId: paperNotePages.id,
      originalObjectKey: paperNotePages.originalObjectKey,
      analysisObjectKey: paperNotePages.analysisObjectKey,
    }).from(paperNotePages)
      .innerJoin(paperNoteBatches, eq(paperNoteBatches.id, paperNotePages.batchId))
      .where(and(
        eq(paperNotePages.id, pageId),
        eq(paperNotePages.batchId, batchId),
        eq(paperNoteBatches.createdBy, createdBy),
      ))
      .limit(1);
    return row ?? null;
  }

  async resolveEntry(createdBy: string, entryId: string) {
    const [row] = await this.database.select({
      batchId: paperNotePages.batchId,
      pageId: paperNotePages.id,
      originalObjectKey: paperNotePages.originalObjectKey,
      analysisObjectKey: paperNotePages.analysisObjectKey,
    }).from(paperNoteEntries)
      .innerJoin(paperNotePages, eq(paperNotePages.id, paperNoteEntries.pageId))
      .innerJoin(paperNoteBatches, eq(paperNoteBatches.id, paperNoteEntries.batchId))
      .where(and(
        eq(paperNoteEntries.id, entryId),
        eq(paperNoteBatches.createdBy, createdBy),
      ))
      .limit(1);
    return row ?? null;
  }

  async resolveActivity(createdBy: string, activityId: string) {
    const result = await this.database.execute(sql`
      select
        batches.id as "batchId",
        pages.id as "pageId",
        pages.original_object_key as "originalObjectKey",
        pages.analysis_object_key as "analysisObjectKey"
      from activities activity
      join paper_note_entries entries on entries.id = activity.paper_note_entry_id
      join paper_note_pages pages on pages.id = entries.page_id
      join paper_note_batches batches on batches.id = entries.batch_id
      where activity.id = ${activityId}::uuid
        and activity.source_type = 'paper_note'
        and batches.created_by = ${createdBy}
      limit 1
    `);
    return firstQueryRow(result, isPaperNoteResolvedSource);
  }
}
