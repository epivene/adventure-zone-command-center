import { describe, expect, it, vi } from "vitest";

import { runActReviewMigrationsAtStartup } from "./act-review-startup";

function fakeClient(options?: {
  locked?: boolean;
  researchReady?: boolean;
  leadScoutRelease2Ready?: boolean;
  leadScoutRelease3Ready?: boolean;
  paperNotesReady?: boolean;
  assistantJobsReady?: boolean;
  scoutAlertsReady?: boolean;
}) {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: options?.locked ?? true }] };
      if (sql.includes("profile_research_runs") && sql.includes("AS ready")) return { rows: [{ ready: options?.researchReady ?? true }] };
      if (sql.includes("candidate_key") && sql.includes("AS ready")) return { rows: [{ ready: options?.leadScoutRelease2Ready ?? true }] };
      if (sql.includes("enrichment_status") && sql.includes("coverage_gaps") && sql.includes("as ready")) {
        return { rows: [{ ready: options?.leadScoutRelease3Ready ?? true }] };
      }
      if (sql.includes("paper_note_batches") && sql.includes("paper_note_pages") && sql.includes("as ready")) {
        return { rows: [{ ready: options?.paperNotesReady ?? true }] };
      }
      if (sql.includes("assistant_jobs") && sql.includes("assistant_job_findings") && sql.includes("as ready")) {
        return { rows: [{ ready: options?.assistantJobsReady ?? true }] };
      }
      if (sql.includes("scout_alert_watches") && sql.includes("scout_alerts_visible_idx") && sql.includes("as ready")) {
        return { rows: [{ ready: options?.scoutAlertsReady ?? true }] };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { client, queries, wasReleased: () => released };
}

describe("runActReviewMigrationsAtStartup", () => {
  it("pre-acquires the migration lock without waiting and checks all additive schemas", async () => {
    const { client, queries, wasReleased } = fakeClient();
    const runMigrations = vi.fn(async (options: any) => {
      const migrationClient = await options.pool.connect();
      await migrationClient.query("SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))");
      migrationClient.release();
      return ["043_act_archive_full_recovery.sql"];
    });

    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations });

    expect(applied).toEqual(["043_act_archive_full_recovery.sql"]);
    expect(queries[0]).toContain("pg_try_advisory_lock");
    expect(queries).toContain("SET lock_timeout = '5s'");
    expect(queries).toContain("SET statement_timeout = '20s'");
    expect(queries.some((sql) => sql.includes("profile_research_runs") && sql.includes("lead_scout_runs") && sql.includes("AS ready"))).toBe(true);
    expect(queries.some((sql) => sql.includes("candidate_key") && sql.includes("AS ready"))).toBe(true);
    expect(queries.some((sql) => sql.includes("enrichment_status") && sql.includes("coverage_gaps"))).toBe(true);
    expect(queries.some((sql) => sql.includes("paper_note_batches") && sql.includes("paper_note_pages"))).toBe(true);
    expect(queries.some((sql) => sql.includes("assistant_jobs") && sql.includes("assistant_job_findings"))).toBe(true);
    expect(queries.some((sql) => sql.includes("scout_alert_watches") && sql.includes("scout_alerts_visible_idx"))).toBe(true);
    expect(queries).toContain("SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))");
    expect(queries).toContain("RESET statement_timeout");
    expect(queries).toContain("RESET lock_timeout");
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
    expect(wasReleased()).toBe(true);
  });

  it("creates the profile research and lead scout base schemas before running the legacy registry", async () => {
    const { client, queries } = fakeClient({ researchReady: false });
    const runMigrations = vi.fn(async () => []);
    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations });
    expect(applied).toEqual(["061_profile_research_runs.sql", "063_lead_scout_runs.sql"]);
    expect(queries.some((sql) => sql.includes("create table if not exists profile_research_runs"))).toBe(true);
    expect(queries.some((sql) => sql.includes("create table if not exists lead_scout_runs"))).toBe(true);
    expect(queries.some((sql) => sql.includes("create table if not exists lead_scout_candidates"))).toBe(true);
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it("adds the Release 2 candidate identity schema when needed", async () => {
    const { client, queries } = fakeClient({ leadScoutRelease2Ready: false });
    const runMigrations = vi.fn(async () => []);
    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations });
    expect(applied).toEqual(["064_lead_scout_candidate_key.sql"]);
    expect(queries.some((sql) => sql.includes("add column if not exists candidate_key"))).toBe(true);
  });

  it("adds the Release 3 enrichment schema when needed", async () => {
    const { client, queries } = fakeClient({ leadScoutRelease3Ready: false });
    const runMigrations = vi.fn(async () => []);
    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations });
    expect(applied).toEqual(["065_lead_scout_enrichment.sql"]);
    expect(queries.some((sql) => sql.includes("add column if not exists enrichment_status"))).toBe(true);
    expect(queries.some((sql) => sql.includes("fit_cautions"))).toBe(true);
    expect(queries.some((sql) => sql.includes("lead_scout_candidates_run_enrichment_idx"))).toBe(true);
  });

  it("repairs the Paper Notes schema before running the legacy registry", async () => {
    const { client, queries } = fakeClient({ paperNotesReady: false });
    const runMigrations = vi.fn(async () => []);
    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations });
    expect(applied).toContain("066_paper_notes_importer.sql");
    expect(queries.some((sql) => sql.includes("create table if not exists paper_note_batches"))).toBe(true);
    expect(queries.some((sql) => sql.includes("create table if not exists paper_note_pages"))).toBe(true);
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it("adds the assistant command job schema when needed", async () => {
    const { client, queries } = fakeClient({ assistantJobsReady: false });
    const runMigrations = vi.fn(async () => []);
    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations });
    expect(applied).toEqual(["067_assistant_command_jobs.sql"]);
    expect(queries.some((sql) => sql.includes("create table if not exists assistant_jobs"))).toBe(true);
  });

  it("adds the Scout Alerts schema when needed", async () => {
    const { client, queries } = fakeClient({ scoutAlertsReady: false });
    const runMigrations = vi.fn(async () => []);
    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations });
    expect(applied).toEqual(["068_scout_alerts.sql"]);
    expect(queries.some((sql) => sql.includes("create table if not exists scout_alert_watches"))).toBe(true);
    expect(queries.some((sql) => sql.includes("create table if not exists scout_alerts"))).toBe(true);
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it("does not block startup when another process owns the migration lock", async () => {
    const { client, queries, wasReleased } = fakeClient({ locked: false });
    const runMigrations = vi.fn(async () => ["unexpected.sql"]);
    const onLockUnavailable = vi.fn();
    const applied = await runActReviewMigrationsAtStartup({ pool: { connect: async () => client }, runMigrations, onLockUnavailable });
    expect(applied).toEqual([]);
    expect(runMigrations).not.toHaveBeenCalled();
    expect(onLockUnavailable).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(1);
    expect(wasReleased()).toBe(true);
  });

  it("releases the pre-acquired lock when the migration runner fails", async () => {
    const { client, queries, wasReleased } = fakeClient();
    await expect(runActReviewMigrationsAtStartup({
      pool: { connect: async () => client },
      runMigrations: async () => { throw new Error("migration failed"); },
    })).rejects.toThrow("migration failed");
    expect(queries).toContain("RESET statement_timeout");
    expect(queries).toContain("RESET lock_timeout");
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
    expect(wasReleased()).toBe(true);
  });
});
