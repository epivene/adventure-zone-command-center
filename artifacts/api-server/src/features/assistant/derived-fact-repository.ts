import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import type { DerivedFactCandidate } from "./derived-fact-extractor";

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
