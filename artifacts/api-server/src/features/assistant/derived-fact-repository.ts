import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import type { DerivedFactCandidate } from "./derived-fact-extractor";

export type DerivedFactReviewItem = {
  id: string;
  factKind: string;
  summary: string;
  value: unknown;
  confidence: "high" | "medium" | "low";
  sourceActivityId: string | null;
  sourceRecordId: string | null;
  sourceVersionId: string | null;
  status: "proposed" | "confirmed" | "dismissed";
  createdAt: string;
};

export class DerivedFactRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async saveProposed(input: {
    organizationId?: string;
    contactId?: string;
    bookingId?: string;
    candidates: readonly DerivedFactCandidate[];
  }): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;
    for (const candidate of input.candidates) {
      const result = await this.pool.query(
        `INSERT INTO derived_crm_facts
           (organization_id, contact_id, booking_id, fact_kind, value, summary,
            confidence, source_activity_id, source_record_id, source_version_id,
            extraction_fingerprint, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,'proposed')
         ON CONFLICT (extraction_fingerprint) DO NOTHING
         RETURNING id`,
        [
          input.organizationId ?? null,
          input.contactId ?? null,
          input.bookingId ?? null,
          candidate.factKind,
          JSON.stringify(candidate.value),
          candidate.summary,
          candidate.confidence,
          candidate.sourceActivityId,
          candidate.sourceRecordId,
          candidate.sourceVersionId,
          candidate.extractionFingerprint,
        ],
      );
      if (result.rowCount === 1) inserted += 1;
      else skipped += 1;
    }
    return { inserted, skipped };
  }

  async listForProfile(input: {
    organizationId?: string;
    contactId?: string;
    status?: "proposed" | "confirmed" | "dismissed";
  }): Promise<DerivedFactReviewItem[]> {
    if (!input.organizationId && !input.contactId) return [];
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
    if (input.status) {
      params.push(input.status);
      clauses.push(`status = $${params.length}`);
    }
    const result = await this.pool.query(
      `SELECT id, fact_kind, summary, value, confidence, source_activity_id,
              source_record_id, source_version_id, status, created_at
       FROM derived_crm_facts
       WHERE (${clauses.slice(0, input.contactId && input.organizationId ? 2 : 1).join(" OR ")})
         ${input.status ? `AND ${clauses.at(-1)}` : ""}
       ORDER BY CASE status WHEN 'proposed' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
                created_at DESC
       LIMIT 100`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      factKind: row.fact_kind,
      summary: row.summary,
      value: row.value,
      confidence: row.confidence,
      sourceActivityId: row.source_activity_id,
      sourceRecordId: row.source_record_id,
      sourceVersionId: row.source_version_id,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async setStatus(input: {
    factId: string;
    status: "confirmed" | "dismissed";
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE derived_crm_facts
       SET status = $2, updated_at = now()
       WHERE id = $1 AND status = 'proposed'
       RETURNING id`,
      [input.factId, input.status],
    );
    return result.rowCount === 1;
  }
}
