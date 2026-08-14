-- Add a composite index on (kind, timeline_sort_at) scoped to the two kind
-- values used by the calendar query.  PostgreSQL can satisfy the full WHERE
-- clause (kind = 'calendar' OR kind = 'act_history') via index-only scans
-- on this partial index, avoiding a full table scan at scale.
CREATE INDEX IF NOT EXISTS activities_kind_timeline_sort_at_idx
  ON activities (kind, timeline_sort_at)
  WHERE kind IN ('calendar', 'act_history');
