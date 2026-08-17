-- Recoverable event-profile archive state.
-- Archiving affects only organizations; linked contacts, bookings, history and relationships remain intact.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS organizations_archived_at_idx
  ON organizations (archived_at);
