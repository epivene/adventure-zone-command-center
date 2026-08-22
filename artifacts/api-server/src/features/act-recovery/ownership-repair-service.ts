import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { DrizzleActArchiveRecoveryRepository } from "./recovery-repository";
import { ActRecoveryReviewService, type ActRecoveryStatus } from "./review-service";

type DrizzleDatabase = typeof applicationDatabase;

type Row = { sourceDatabaseKey?: unknown };

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function notFound(code: string) {
  return Object.assign(new Error(code), { status: 404, code });
}

export class ActOwnershipRepairService {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly recoveryRepository = new DrizzleActArchiveRecoveryRepository(database),
    private readonly reviewService = new ActRecoveryReviewService(database, recoveryRepository),
  ) {}

  async start(input: { requestedBy: string }): Promise<ActRecoveryStatus> {
    const sourceRows = rows(await this.database.execute(sql`
      select source_database_key as "sourceDatabaseKey"
      from act_source_records
      where latest_version_id is not null
      group by source_database_key
      order by max(updated_at) desc nulls last, source_database_key
      limit 1
    `));
    const sourceDatabaseKey = typeof sourceRows[0]?.sourceDatabaseKey === "string"
      ? sourceRows[0].sourceDatabaseKey.trim()
      : "";
    if (!sourceDatabaseKey) throw notFound("act_recovery_archive_empty");

    const requestKey = `act-note-ownership-repair:${new Date().toISOString()}:${randomUUID()}`;
    const run = await this.recoveryRepository.createOrGetRun({
      sourceDatabaseKey,
      requestKey,
      requestedBy: input.requestedBy,
      now: new Date(),
      streamTypes: ["note", "history", "activity"],
    });
    return this.reviewService.status({ runId: run.runId });
  }
}
