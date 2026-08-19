import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import { createAiClient } from "@/features/ai-suggestions/ai-client";
import { AiDerivedFactExtractor } from "./derived-fact-extractor";
import { DerivedFactRepository } from "./derived-fact-repository";

type DerivedFactActivityRow = {
  id: string;
  body: string;
  occurred_at: string | Date | null;
  source_record_id: string | null;
  source_version_id: string | null;
};

function historicalDetailScore(body: string): number {
  const text = body.toLowerCase();
  let score = 0;

  const hasBookingContext =
    /adventure zone|warrior'?s playground|weekend warriors?|pirate'?s rebellion|paintball|package|event|fair|festival|carnival|booking|contract/.test(
      text,
    );
  const hasMoney = /\$\s?\d[\d,]*(?:\.\d{1,2})?|\b(?:quoted?|quote|price|pricing|cost|paid|deposit|revenue share|percentage|percent|fee)\b/.test(
    text,
  );

  if (hasBookingContext && hasMoney) score += 100;
  if (/\b(?:setup|set up|tear ?down|load[- ]?out|forklift|loader|access)\b/.test(text)) score += 70;
  if (/\b(?:220v|110v|power|generator|electric|outlet|amp|50a)\b/.test(text)) score += 60;
  if (/\b(?:water|pool|fill|hose|hydrant|wet ride|slide)\b/.test(text)) score += 60;
  if (/\b(?:stake|stakes|anchor|anchoring|ballast|concrete|asphalt|space|square feet|sq\.? ?ft)\b/.test(text)) score += 55;
  if (/adventure zone|warrior'?s playground|weekend warriors?|pirate'?s rebellion|paintball/.test(text)) score += 45;
  if (/\b(?:attractions?|inflatable|games?|boats?|obstacle|arena)\b/.test(text)) score += 30;

  return score;
}

export function selectActivitiesForDerivedFactExtraction(
  rows: readonly DerivedFactActivityRow[],
  limit = 40,
) {
  if (limit <= 0) return [];

  const ranked = rows.map((row, index) => ({
    row,
    index,
    score: historicalDetailScore(String(row.body ?? "")),
  }));

  const priority = ranked
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selectedIds = new Set(priority.slice(0, limit).map((entry) => entry.row.id));

  for (const entry of ranked) {
    if (selectedIds.size >= limit) break;
    selectedIds.add(entry.row.id);
  }

  return ranked
    .filter((entry) => selectedIds.has(entry.row.id))
    .sort((left, right) => left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.row);
}

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
  const directClauses: string[] = [];
  const associationClauses: string[] = [];
  if (input.organizationId) {
    params.push(input.organizationId);
    directClauses.push(`activities.organization_id = $${params.length}`);
    associationClauses.push(`associated.organization_id = $${params.length}`);
  }
  if (input.contactId) {
    params.push(input.contactId);
    directClauses.push(`activities.contact_id = $${params.length}`);
    associationClauses.push(`associated.contact_id = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT activities.id, activities.body,
            COALESCE(activities.occurred_at, activities.timeline_sort_at, activities.created_at) AS occurred_at,
            activities.source_record_id, activities.source_version_id
     FROM activities
     WHERE (
       (${directClauses.join(" OR ")})
       OR EXISTS (
         SELECT 1
         FROM activity_associations associated
         WHERE associated.activity_id = activities.id
           AND (${associationClauses.join(" OR ")})
       )
     )
       AND activities.deleted_at IS NULL
       AND length(trim(activities.body)) > 0
       AND (
         activities.source_record_id IS NOT NULL
         OR activities.kind = 'act_history'
         OR activities.source_type IN ('note','history','activity')
       )
     ORDER BY COALESCE(activities.occurred_at, activities.timeline_sort_at, activities.created_at) DESC,
              activities.created_at DESC
     LIMIT 250`,
    params,
  );
  const selectedRows = selectActivitiesForDerivedFactExtraction(
    result.rows as DerivedFactActivityRow[],
    40,
  );
  const activities = selectedRows.map((row) => ({
    id: row.id,
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
