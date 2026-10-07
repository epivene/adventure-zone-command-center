-- Preserve original HTML when syncing existing profile conversations. Existing text stays intact.
ALTER TABLE google_workspace_profile_email_messages ADD COLUMN IF NOT EXISTS body_html text;
