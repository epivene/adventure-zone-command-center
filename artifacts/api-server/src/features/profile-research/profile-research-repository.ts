import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import type {
  ProfileResearchContext,
  ProfileResearchSource,
  ProfileResearchSuggestion,
  ResearchMode,
} from "./profile-research-types";

export type ProfileResearchRunStatus = "running" | "complete" | "failed";

export type ProfileResearchRun = {
  id: string;
  profileId: string;
  mode: ResearchMode;
  status: ProfileResearchRunStatus;
  requestedBy: string | null;
  startedAt: string;
  completedAt: string | null;
  failureMessage: string | null;
  context: ProfileResearchContext;
  summary: unknown | null;
  sources: ProfileResearchSource[];
  suggestions: Array<ProfileResearchSuggestion & { reviewStatus: "pending" | "accepted" | "dismissed" }>;
};

function sourceFromRow(row: any): ProfileResearchSource {
  return {
    id: row.source_key,
    kind: row.kind,
    title: row.title,
    url: row.url,
    publisher: row.publisher,
    retrievedAt: new Date(row.retrieved_at).toISOString(),
    excerpt: row.excerpt ?? "",
  };
}

function suggestionFromRow(row: any): ProfileResearchRun["suggestions"][number] {
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    field: row.field,
    currentValue: row.current_value,
    suggestedValue: row.suggested_value,
    confidence: row.confidence,
    rationale: row.rationale,
    sourceIds: Array.isArray(row.source_keys) ? row.source_keys : [],
    conflict: Boolean(row.conflict),
    reviewStatus: row.review_status,
  };
}

export class ProfileResearchRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async createRun(input: {
    profileId: string;
    mode: ResearchMode;
    requestedBy?: string | null;
    context: ProfileResearchContext;
  }): Promise<string> {
    const result = await this.pool.query(
      `insert into profile_research_runs
        (profile_id, mode, status, requested_by, context_snapshot)
       values ($1, $2, 'running', $3, $4::jsonb)
       returning id`,
      [input.profileId, input.mode, input.requestedBy ?? null, JSON.stringify(input.context)],
    );
    return result.rows[0].id as string;
  }

  async completeRun(input: {
    runId: string;
    profileId: string;
    sources: ProfileResearchSource[];
    suggestions: ProfileResearchSuggestion[];
    summary?: unknown;
    coverageLease?: { itemId: string; workerId: string };
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (input.coverageLease) {
        const lease = await client.query(
          `select id from event_date_coverage_items
           where id = $1
             and status = 'researching'
             and lease_owner = $2
             and lease_expires_at >= now()
           for update`,
          [input.coverageLease.itemId, input.coverageLease.workerId],
        );
        if (!lease.rows.length) throw new Error("COVERAGE_LEASE_LOST");
      }
      const owner = await client.query(
        `select id from profile_research_runs where id = $1 and profile_id = $2 for update`,
        [input.runId, input.profileId],
      );
      if (!owner.rows.length) throw new Error("PROFILE_RESEARCH_RUN_NOT_FOUND");

      for (const source of input.sources) {
        await client.query(
          `insert into profile_research_sources
            (run_id, source_key, kind, title, url, publisher, retrieved_at, excerpt)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (run_id, source_key) do update set
             kind = excluded.kind,
             title = excluded.title,
             url = excluded.url,
             publisher = excluded.publisher,
             retrieved_at = excluded.retrieved_at,
             excerpt = excluded.excerpt`,
          [input.runId, source.id, source.kind, source.title, source.url, source.publisher, source.retrievedAt, source.excerpt.slice(0, 1200)],
        );
      }

      for (const suggestion of input.suggestions) {
        await client.query(
          `insert into profile_research_suggestions
            (id, run_id, target_kind, target_id, field, current_value, suggested_value, confidence, rationale, source_keys, conflict)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
           on conflict (run_id, target_kind, target_id, field, suggested_value) do nothing`,
          [suggestion.id, input.runId, suggestion.targetKind, suggestion.targetId, suggestion.field, suggestion.currentValue, suggestion.suggestedValue, suggestion.confidence, suggestion.rationale, JSON.stringify(suggestion.sourceIds), suggestion.conflict],
        );
      }

      await client.query(
        `update profile_research_runs
         set status = 'complete', completed_at = now(), summary = $3::jsonb, updated_at = now()
         where id = $1 and profile_id = $2`,
        [input.runId, input.profileId, JSON.stringify(input.summary ?? null)],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async failRun(runId: string, profileId: string, message: string): Promise<void> {
    await this.pool.query(
      `update profile_research_runs
       set status = 'failed', failure_message = $3, completed_at = now(), updated_at = now()
       where id = $1 and profile_id = $2`,
      [runId, profileId, message.slice(0, 1000)],
    );
  }

  async getRun(profileId: string, runId: string): Promise<ProfileResearchRun | null> {
    const [runResult, sourceResult, suggestionResult] = await Promise.all([
      this.pool.query(`select * from profile_research_runs where id = $1 and profile_id = $2`, [runId, profileId]),
      this.pool.query(`select * from profile_research_sources where run_id = $1 order by created_at, source_key`, [runId]),
      this.pool.query(`select * from profile_research_suggestions where run_id = $1 order by created_at, id`, [runId]),
    ]);
    const row = runResult.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      profileId: row.profile_id,
      mode: row.mode,
      status: row.status,
      requestedBy: row.requested_by,
      startedAt: new Date(row.started_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      failureMessage: row.failure_message,
      context: row.context_snapshot,
      summary: row.summary,
      sources: sourceResult.rows.map(sourceFromRow),
      suggestions: suggestionResult.rows.map(suggestionFromRow),
    };
  }

  async setSuggestionReview(input: {
    profileId: string;
    runId: string;
    suggestionId: string;
    status: "accepted" | "dismissed";
  }): Promise<boolean> {
    const result = await this.pool.query(
      `update profile_research_suggestions suggestion
       set review_status = $4, reviewed_at = now()
       where suggestion.id = $3
         and suggestion.run_id = $2
         and exists (
           select 1 from profile_research_runs run
           where run.id = suggestion.run_id and run.profile_id = $1
         )
       returning suggestion.id`,
      [input.profileId, input.runId, input.suggestionId, input.status],
    );
    return result.rows.length > 0;
  }
}
