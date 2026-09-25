ALTER TABLE assistant_workspace_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS assistant_workspace_screenshots (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL, actor_id text NOT NULL,
 filename text NOT NULL, content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
 byte_size integer NOT NULL CHECK(byte_size>0 AND byte_size<=5242880), sha256 text NOT NULL, object_key text NOT NULL UNIQUE,
 ready boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id)
);
CREATE INDEX IF NOT EXISTS assistant_workspace_screenshot_owner_idx ON assistant_workspace_screenshots(actor_id,conversation_id);
