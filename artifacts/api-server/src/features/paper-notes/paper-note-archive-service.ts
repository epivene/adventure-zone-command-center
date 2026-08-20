import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { PaperNoteImportError } from "./paper-note-import-service";

type DrizzleDatabase = typeof database;

export class PaperNoteArchiveService {
  constructor(private readonly database: DrizzleDatabase) {}

  async archiveBatch(actorId: string, batchId: string, now: Date) {
    const result = await this.database.execute(sql`
      update paper_note_batches
      set status = 'archived', updated_at = ${now}
      where id = ${batchId}::uuid
        and created_by = ${actorId}
        and status = 'imported'
      returning id
    `);
    if ((result as { rows?: unknown[] }).rows?.length) return;

    const existing = await this.database.execute(sql`
      select status
      from paper_note_batches
      where id = ${batchId}::uuid and created_by = ${actorId}
      limit 1
    `);
    const row = (existing as { rows?: Array<{ status: string }> }).rows?.[0];
    if (!row) {
      throw new PaperNoteImportError("BATCH_NOT_FOUND", "Paper-note batch was not found.");
    }
    throw new PaperNoteImportError(
      "BATCH_NOT_READY",
      "Only a completed paper-note import can be archived.",
    );
  }
}
