CREATE TABLE IF NOT EXISTS google_pilot_sync (
 connection_id uuid NOT NULL, profile_id uuid NOT NULL, thread_id text NOT NULL,
 baseline_message_id text NOT NULL, baseline_state text NOT NULL,
 snapshot jsonb, fingerprint text, checked_at timestamptz, attempted_at timestamptz,
 error_code text, lease_token uuid, lease_until timestamptz,
 PRIMARY KEY(connection_id,thread_id)
);
CREATE TABLE IF NOT EXISTS google_pilot_sync_history (
 connection_id uuid NOT NULL, thread_id text NOT NULL, fingerprint text NOT NULL,
 snapshot jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,thread_id,fingerprint)
);
INSERT INTO google_pilot_sync(connection_id,profile_id,thread_id,baseline_message_id,baseline_state) VALUES
 ('da54625d-b6f1-4486-8299-e1d85d78422e','20943487-43ec-4a11-8c67-36efefbf4efb','1a0919b8cb94ba54','1a0f89ff05a44f32','owner_decision'),
 ('da54625d-b6f1-4486-8299-e1d85d78422e','314df1f0-1ec8-4157-b98d-47cf4e1e65f8','1a0ffa84e17615ce','1a111da28ae2bdb8','contact_blocked'),
 ('da54625d-b6f1-4486-8299-e1d85d78422e','3f17b281-9e49-4ee9-a640-53d04b218322','1a0a277b5f84ad3a','1a0a5bb6deb04e32','draft_to_review')
ON CONFLICT DO NOTHING;
