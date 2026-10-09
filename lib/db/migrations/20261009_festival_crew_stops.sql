CREATE TABLE IF NOT EXISTS festival_crew_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES festival_editions(id) ON DELETE CASCADE,
  source_key text,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS festival_crew_stops_edition_idx ON festival_crew_stops(edition_id);
CREATE UNIQUE INDEX IF NOT EXISTS festival_crew_stops_edition_source_unique
  ON festival_crew_stops(edition_id, source_key) WHERE source_key IS NOT NULL;
