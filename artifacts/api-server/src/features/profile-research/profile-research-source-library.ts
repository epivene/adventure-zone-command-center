import { pool } from "@workspace/db";
import { db } from "@/db/client";
import { isSafeResearchUrl } from "./profile-research-matching";
import { matchRelatedEventsAgainstCrm } from "./profile-research-related-event-matcher";
import { OpenAiSourceScoutProvider } from "./profile-research-source-scout";
import type { InternalEventDateEvidence } from "@/features/event-date-coverage/internal-event-date-evidence";

export type SavedResearchSource = {
  id: string;
  url: string;
  title: string;
  notes: string | null;
  archivedAt: string | null;
  lastScoutedAt: string | null;
  lastScoutStartDate: string | null;
  lastScoutEndDate: string | null;
  lastScoutResults: any[];
};

function rowToSource(row: any): SavedResearchSource {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    notes: row.notes,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    lastScoutedAt: row.last_scouted_at ? new Date(row.last_scouted_at).toISOString() : null,
    lastScoutStartDate: row.last_scout_start_date,
    lastScoutEndDate: row.last_scout_end_date,
    lastScoutResults: Array.isArray(row.last_scout_results) ? row.last_scout_results : [],
  };
}

export function extractSavedSourceEventDateEvidence(
  source: SavedResearchSource,
): InternalEventDateEvidence[] {
  return source.lastScoutResults.flatMap((result, index) => {
    if (!result || typeof result !== "object") return [];
    const startsOn = typeof result.startsOn === "string"
      ? result.startsOn
      : typeof result.startDate === "string" ? result.startDate : null;
    const endsOn = typeof result.endsOn === "string"
      ? result.endsOn
      : typeof result.endDate === "string" ? result.endDate : null;
    if (!startsOn || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return [];
    return [{
      startsOn,
      endsOn: endsOn && /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? endsOn : null,
      evidenceKind: "published_exact" as const,
      sourceKind: "internal" as const,
      sourceType: "prior_research",
      sourceId: `${source.id}:${String(result.id ?? index)}`,
      sourceLabel: source.title,
      excerpt: typeof result.name === "string" ? result.name.slice(0, 160) : null,
    }];
  });
}

export class ProfileResearchSourceLibraryService {
  async list(includeArchived = false) {
    const result = await pool.query(
      `select * from profile_research_saved_sources
       ${includeArchived ? "" : "where archived_at is null"}
       order by coalesce(last_scouted_at, created_at) desc, title asc`,
    );
    return result.rows.map(rowToSource);
  }

  async save(input: { url: string; title?: string | null; notes?: string | null }) {
    if (!isSafeResearchUrl(input.url)) throw new Error("INVALID_RESEARCH_SOURCE_URL");
    const title = input.title?.trim() || new URL(input.url).hostname;
    const result = await pool.query(
      `insert into profile_research_saved_sources (url, title, notes)
       values ($1,$2,$3)
       on conflict (url) do update set
         title = excluded.title,
         notes = coalesce(excluded.notes, profile_research_saved_sources.notes),
         archived_at = null,
         updated_at = now()
       returning *`,
      [input.url, title, input.notes?.trim() || null],
    );
    return rowToSource(result.rows[0]);
  }

  async update(id: string, input: { title?: string; notes?: string | null }) {
    const result = await pool.query(
      `update profile_research_saved_sources
       set title = coalesce($2, title), notes = $3, updated_at = now()
       where id = $1 returning *`,
      [id, input.title?.trim() || null, input.notes === undefined ? null : input.notes?.trim() || null],
    );
    return result.rows[0] ? rowToSource(result.rows[0]) : null;
  }

  async archive(id: string) {
    const result = await pool.query(
      `update profile_research_saved_sources
       set archived_at = now(), updated_at = now()
       where id = $1 returning id`,
      [id],
    );
    return result.rows.length > 0;
  }

  async scout(id: string, input: { startDate: string; endDate: string }) {
    const current = await pool.query(
      `select * from profile_research_saved_sources where id = $1 and archived_at is null`,
      [id],
    );
    if (!current.rows[0]) throw new Error("RESEARCH_SOURCE_NOT_FOUND");
    const source = rowToSource(current.rows[0]);
    const provider = new OpenAiSourceScoutProvider();
    const result = await provider.scout({
      sourceUrl: source.url,
      sourceTitle: source.title,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    const classified = await matchRelatedEventsAgainstCrm(db, result.events);
    const saved = await pool.query(
      `update profile_research_saved_sources
       set last_scouted_at = now(), last_scout_start_date = $2,
           last_scout_end_date = $3, last_scout_results = $4::jsonb, updated_at = now()
       where id = $1 returning *`,
      [id, input.startDate, input.endDate, JSON.stringify(classified)],
    );
    return rowToSource(saved.rows[0]);
  }
}
