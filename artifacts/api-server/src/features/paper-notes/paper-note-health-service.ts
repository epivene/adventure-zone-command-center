import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import type {
  PaperNoteConfigurationView,
  PaperNoteOperationalSummary,
} from "./paper-note-types";

type DrizzleDatabase = typeof database;

type HealthEnvironment = Partial<Record<
  | "GOOGLE_CLOUD_STORAGE_BUCKET"
  | "LEG_MANAGER_RECEIPT_BUCKET"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  string | undefined
>>;

export interface PaperNoteHealthRepository {
  operationalSummary(): Promise<PaperNoteOperationalSummary>;
}

export class PaperNoteHealthService {
  constructor(
    private readonly repository: PaperNoteHealthRepository,
    private readonly env: HealthEnvironment = process.env,
  ) {}

  async health(): Promise<{
    configuration: PaperNoteConfigurationView;
    operations: PaperNoteOperationalSummary;
  }> {
    return {
      configuration: {
        storageAvailable: Boolean(
          this.env.GOOGLE_CLOUD_STORAGE_BUCKET?.trim() ||
          this.env.LEG_MANAGER_RECEIPT_BUCKET?.trim(),
        ),
        aiAvailable: Boolean(
          this.env.OPENAI_API_KEY?.trim() ||
          this.env.ANTHROPIC_API_KEY?.trim() ||
          this.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY?.trim(),
        ),
        maxBatchPages: 25,
        maxImageBytes: 12 * 1024 * 1024,
        acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      },
      operations: await this.repository.operationalSummary(),
    };
  }
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export class DrizzlePaperNoteHealthRepository implements PaperNoteHealthRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async operationalSummary(): Promise<PaperNoteOperationalSummary> {
    const result = await this.database.execute(sql`
      select
        (select count(*)::int from paper_note_pages where status = 'queued') as "queuedPages",
        (select count(*)::int from paper_note_pages where status = 'extracting') as "extractingPages",
        (select count(*)::int from paper_note_pages where status = 'needs_retry') as "retryablePages",
        (select count(*)::int from paper_note_batches where status = 'review') as "batchesWaitingForReview",
        (select count(*)::int from paper_note_batches where imported_at >= now() - interval '24 hours') as "importedBatchesLast24Hours",
        (select count(*)::int from paper_note_batches where status = 'failed' and updated_at >= now() - interval '24 hours') as "failedImportsLast24Hours",
        (
          select avg(extract(epoch from (extracted_at - created_at)) * 1000)
          from paper_note_pages
          where extracted_at is not null
            and extracted_at >= now() - interval '24 hours'
        ) as "averagePageExtractionMs",
        (
          select case when count(*) = 0 then null
            else count(*) filter (where last_error_code = 'MALFORMED_OUTPUT')::float / count(*)::float
          end
          from paper_note_pages
          where updated_at >= now() - interval '24 hours'
        ) as "malformedOutputRate",
        (
          select case when count(*) = 0 then null
            else count(*) filter (where last_error_code = 'PROVIDER_UNAVAILABLE')::float / count(*)::float
          end
          from paper_note_pages
          where updated_at >= now() - interval '24 hours'
        ) as "providerUnavailableRate"
    `);
    const row = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? {};
    return {
      queuedPages: Number(row.queuedPages ?? 0),
      extractingPages: Number(row.extractingPages ?? 0),
      retryablePages: Number(row.retryablePages ?? 0),
      batchesWaitingForReview: Number(row.batchesWaitingForReview ?? 0),
      importedBatchesLast24Hours: Number(row.importedBatchesLast24Hours ?? 0),
      failedImportsLast24Hours: Number(row.failedImportsLast24Hours ?? 0),
      averagePageExtractionMs: numberOrNull(row.averagePageExtractionMs),
      malformedOutputRate: numberOrNull(row.malformedOutputRate),
      providerUnavailableRate: numberOrNull(row.providerUnavailableRate),
    };
  }
}
