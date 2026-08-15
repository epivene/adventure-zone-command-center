ALTER TABLE event_family_suggestions
  DROP CONSTRAINT IF EXISTS event_family_suggestions_normalized_name_candidate_fingerpr_key;

DROP INDEX IF EXISTS event_family_suggestions_identity_unique;

CREATE UNIQUE INDEX IF NOT EXISTS event_family_suggestions_identity_hash_unique
  ON event_family_suggestions(normalized_name, md5(candidate_fingerprint));
