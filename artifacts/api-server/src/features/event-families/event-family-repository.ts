import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";
import { normalizeFamilyName, type EventFamilyProposal } from "./event-family-classifier";

export class EventFamilyConflictError extends Error {}
export class EventFamilyNotFoundError extends Error {}

export type EventFamilySuggestionRecord = {
  id: string;
  proposedName: string;
  normalizedName: string;
  candidateIds: string[];
  source: "rule" | "ai";
  confidence: number;
  reason: string;
  status: "pending" | "approved" | "dismissed";
  candidates?: Array<{ id: string; name: string; city: string | null; region: string | null }>;
};

export async function ensureEventFamilySchema(pool: Pool = defaultPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_families (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      normalized_name text NOT NULL UNIQUE,
      description text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS event_family_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id uuid NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
      organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
      source text NOT NULL CHECK (source IN ('approved_rule','approved_ai','manual')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (family_id, organization_id)
    );
    CREATE TABLE IF NOT EXISTS event_family_suggestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      proposed_name text NOT NULL,
      normalized_name text NOT NULL,
      candidate_ids jsonb NOT NULL CHECK (jsonb_typeof(candidate_ids) = 'array'),
      candidate_fingerprint text NOT NULL,
      source text NOT NULL CHECK (source IN ('rule','ai')),
      confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      reason text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE event_family_suggestions
      DROP CONSTRAINT IF EXISTS event_family_suggestions_normalized_name_candidate_fingerpr_key;
    DROP INDEX IF EXISTS event_family_suggestions_identity_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS event_family_suggestions_identity_hash_unique
      ON event_family_suggestions (normalized_name, md5(candidate_fingerprint));
    CREATE INDEX IF NOT EXISTS event_family_members_family_id_idx ON event_family_members(family_id);
    CREATE INDEX IF NOT EXISTS event_family_suggestions_pending_idx ON event_family_suggestions(status, created_at DESC);
  `);
}

function fingerprint(ids: readonly string[]): string {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, "en-US")).join(":");
}

function mapSuggestion(row: any): EventFamilySuggestionRecord {
  return {
    id: row.id,
    proposedName: row.proposed_name,
    normalizedName: row.normalized_name,
    candidateIds: row.candidate_ids,
    source: row.source,
    confidence: Number(row.confidence),
    reason: row.reason,
    status: row.status,
    candidates: row.candidates ?? undefined,
  };
}

export class EventFamilyRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async listFamilies() {
    const result = await this.pool.query(`
      SELECT f.id, f.name, f.normalized_name AS "normalizedName", f.description,
             COUNT(m.organization_id)::int AS "memberCount"
      FROM event_families f
      LEFT JOIN event_family_members m ON m.family_id = f.id
      GROUP BY f.id
      ORDER BY f.name
    `);
    return result.rows;
  }

  async getFamily(id: string) {
    const familyResult = await this.pool.query(
      `SELECT id, name, normalized_name AS "normalizedName", description FROM event_families WHERE id = $1`,
      [id],
    );
    const family = familyResult.rows[0];
    if (!family) return null;
    const members = await this.pool.query(`
      SELECT o.id, o.name, o.city, o.region, o.place_type AS "placeType",
             COALESCE((SELECT COUNT(*)::int FROM organization_contacts oc WHERE oc.organization_id = o.id), 0) AS "contactCount",
             COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.organization_id = o.id), 0) AS "bookingCount",
             (SELECT MIN(fu.due_at) FROM follow_ups fu WHERE fu.organization_id = o.id AND fu.completed_at IS NULL AND fu.due_at >= now()) AS "nextFollowUpAt"
      FROM event_family_members m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.family_id = $1
      ORDER BY o.name
    `, [id]);
    return { ...family, memberCount: members.rows.length, members: members.rows };
  }

  async listPendingSuggestions(): Promise<EventFamilySuggestionRecord[]> {
    const result = await this.pool.query(`
      SELECT s.*,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'city', o.city, 'region', o.region) ORDER BY o.name)
          FROM organizations o
          WHERE o.id = ANY(ARRAY(SELECT jsonb_array_elements_text(s.candidate_ids))::uuid[])
        ), '[]'::jsonb) AS candidates
      FROM event_family_suggestions s
      WHERE s.status = 'pending'
      ORDER BY s.created_at DESC
    `);
    return result.rows.map(mapSuggestion);
  }

  async replacePendingSuggestions(proposals: readonly EventFamilyProposal[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM event_family_suggestions WHERE status = 'pending'");
      for (const proposal of proposals) {
        const ids = [...new Set(proposal.candidateIds)].sort((a, b) => a.localeCompare(b, "en-US"));
        if (ids.length < 2) continue;
        await client.query(`
          INSERT INTO event_family_suggestions
            (proposed_name, normalized_name, candidate_ids, candidate_fingerprint, source, confidence, reason)
          VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `, [proposal.proposedName, proposal.normalizedName, JSON.stringify(ids), fingerprint(ids), proposal.source, proposal.confidence, proposal.reason]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async approveSuggestion(id: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const suggestionResult = await client.query(
        `SELECT * FROM event_family_suggestions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const suggestion = suggestionResult.rows[0];
      if (!suggestion) throw new EventFamilyNotFoundError("Suggestion not found");
      if (suggestion.status !== "pending") throw new EventFamilyConflictError("Suggestion is no longer pending");
      const ids = suggestion.candidate_ids as string[];
      const candidates = await client.query(
        `SELECT o.id, o.consolidated_into_id,
                m.family_id
         FROM organizations o
         LEFT JOIN event_family_members m ON m.organization_id = o.id
         WHERE o.id = ANY($1::uuid[])
         FOR UPDATE OF o`,
        [ids],
      );
      if (candidates.rows.length !== ids.length) throw new EventFamilyConflictError("One or more profiles no longer exist");
      if (candidates.rows.some((row) => row.consolidated_into_id)) throw new EventFamilyConflictError("A retired profile cannot be grouped");
      if (candidates.rows.some((row) => row.family_id)) throw new EventFamilyConflictError("A profile already belongs to another event family");

      const familyResult = await client.query(`
        INSERT INTO event_families (name, normalized_name)
        VALUES ($1, $2)
        ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
        RETURNING id, name, normalized_name
      `, [suggestion.proposed_name, suggestion.normalized_name]);
      const familyId = familyResult.rows[0].id;
      const source = suggestion.source === "rule" ? "approved_rule" : "approved_ai";
      for (const organizationId of ids) {
        await client.query(
          `INSERT INTO event_family_members (family_id, organization_id, source) VALUES ($1, $2, $3)`,
          [familyId, organizationId, source],
        );
      }
      await client.query(`UPDATE event_family_suggestions SET status = 'approved', updated_at = now() WHERE id = $1`, [id]);
      await client.query("COMMIT");
      return { familyId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async dismissSuggestion(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE event_family_suggestions SET status = 'dismissed', updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id],
    );
    return result.rowCount === 1;
  }

  async renameFamily(id: string, name: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE event_families SET name = $2, normalized_name = $3, updated_at = now() WHERE id = $1 RETURNING id`,
      [id, name.trim(), normalizeFamilyName(name)],
    );
    return result.rowCount === 1;
  }

  async removeMember(familyId: string, organizationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM event_family_members WHERE family_id = $1 AND organization_id = $2 RETURNING id`,
      [familyId, organizationId],
    );
    return result.rowCount === 1;
  }

  async addMember(familyId: string, organizationId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const family = await client.query(`SELECT id FROM event_families WHERE id = $1 FOR UPDATE`, [familyId]);
      if (!family.rows[0]) throw new EventFamilyNotFoundError("Family not found");
      const organization = await client.query(
        `SELECT o.id, o.consolidated_into_id, m.family_id FROM organizations o LEFT JOIN event_family_members m ON m.organization_id = o.id WHERE o.id = $1 FOR UPDATE OF o`,
        [organizationId],
      );
      const row = organization.rows[0];
      if (!row) throw new EventFamilyNotFoundError("Profile not found");
      if (row.consolidated_into_id) throw new EventFamilyConflictError("A retired profile cannot be grouped");
      if (row.family_id) throw new EventFamilyConflictError("Profile already belongs to an event family");
      await client.query(`INSERT INTO event_family_members (family_id, organization_id, source) VALUES ($1, $2, 'manual')`, [familyId, organizationId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAnalysisCandidates() {
    const result = await this.pool.query(`
      SELECT o.id, o.name, o.place_type AS "placeType", o.city, o.region, m.family_id AS "eventFamilyId"
      FROM organizations o
      LEFT JOIN event_family_members m ON m.organization_id = o.id
      WHERE o.consolidated_into_id IS NULL
        AND m.organization_id IS NULL
        AND o.place_type IN ('festival_event', 'fair', 'city_government', 'venue', 'other')
      ORDER BY o.name
    `);
    return result.rows;
  }
}