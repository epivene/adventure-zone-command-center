import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import { createAiClient } from "@/features/ai-suggestions/ai-client";
import { AiDerivedFactExtractor } from "./derived-fact-extractor";
import { DerivedFactRepository } from "./derived-fact-repository";

export async function extractDerivedFactsForProfile(input: {
  organizationId?: string;
  contactId?: string;
  pool?: Pool;
}): Promise<{
  activityCount: number;
  candidateCount: number;
  inserted: number;
  skipped: number;
}> {
  if (!input.organizationId && !input.contactId) {
    throw new Error("DERIVED_FACT_PARENT_REQUIRED");
  }
  const pool = input.pool ?? defaultPool;
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (input.organizationId) {
    params.push(input.organizationId);
    clauses.push(`organization_id = $${params.length}`);
  }
  if (input.contactId) {
    params.push(input.contactId);
    clauses.push(`contact_id = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT id, body,
            COALESCE(occurred_at, timeline_sort_at, created_at) AS occurred_at,
            source_record_id, source_version_id
     FROM activities
     WHERE (${clauses.join(" OR ")})
       AND deleted_at IS NULL
       AND length(trim(body)) > 0
       AND (
         source_record_id IS NOT NULL
         OR kind = 'act_history'
         OR source_type IN ('note','history','activity')
       )
     ORDER BY COALESCE(occurred_at, timeline_sort_at, created_at) DESC,
              created_at DESC
     LIMIT 40`,
    params,
  );
  const activities = result.rows.map((row) => ({
    id: row.id as string,
    body: String(row.body ?? "").slice(0, 2500),
    occurredAt: row.occurred_at
      ? new Date(row.occurred_at).toISOString()
      : null,
    sourceRecordId: row.source_record_id ?? null,
    sourceVersionId: row.source_version_id ?? null,
  }));
  if (activities.length === 0) {
    return { activityCount: 0, candidateCount: 0, inserted: 0, skipped: 0 };
  }

  const client = await createAiClient();
  const extractor = new AiDerivedFactExtractor(client);
  const candidates = await extractor.extract({
    organizationId: input.organizationId,
    contactId: input.contactId,
    activities,
  });
  const stored = await new DerivedFactRepository(pool).saveProposed({
    organizationId: input.organizationId,
    contactId: input.contactId,
    candidates,
  });
  return {
    activityCount: activities.length,
    candidateCount: candidates.length,
    ...stored,
  };
}
