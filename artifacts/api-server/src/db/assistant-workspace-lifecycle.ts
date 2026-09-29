// Keep in sync with lib/db/migrations/20260926_assistant_conversation_lifecycle.sql.
// These VOLATILE trigger functions use separate SQL commands after taking the
// parent row lock. At READ COMMITTED those commands see any work which committed
// while waiting for the lock, unlike a single CTE with a stale statement snapshot.
export const assistantWorkspaceLifecycleSql = `
ALTER TABLE assistant_workspace_conversations ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assistant_workspace_conversation_lifecycle_valid' AND conrelid='assistant_workspace_conversations'::regclass) THEN
  ALTER TABLE assistant_workspace_conversations ADD CONSTRAINT assistant_workspace_conversation_lifecycle_valid CHECK(lifecycle IN ('active','archived','trashed'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS assistant_workspace_conversation_lifecycle_idx ON assistant_workspace_conversations(actor_id,lifecycle,updated_at DESC);

CREATE OR REPLACE FUNCTION assistant_workspace_guard_lifecycle() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF NEW.lifecycle <> 'active' AND (NEW.selection IS DISTINCT FROM OLD.selection OR NEW.title IS DISTINCT FROM OLD.title) THEN
  RAISE EXCEPTION 'ASSISTANT_CONVERSATION_INACTIVE';
 END IF;
 IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle AND NEW.lifecycle <> 'active' THEN
  -- UPDATE already owns the conversation row lock, also acquired by every start.
  IF EXISTS (SELECT 1 FROM assistant_workspace_runs WHERE conversation_id=NEW.id AND actor_id=NEW.actor_id AND status IN ('queued','running'))
    OR EXISTS (SELECT 1 FROM assistant_workspace_actions WHERE conversation_id=NEW.id AND actor_id=NEW.actor_id AND status IN ('running','provider_started','uncertain'))
    OR EXISTS (SELECT 1 FROM assistant_workspace_drafts WHERE conversation_id=NEW.id AND actor_id=NEW.actor_id AND status IN ('saving','sending','uncertain')) THEN
   RAISE EXCEPTION 'ASSISTANT_CONVERSATION_BUSY';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_workspace_guard_lifecycle ON assistant_workspace_conversations;
CREATE TRIGGER assistant_workspace_guard_lifecycle BEFORE UPDATE OF lifecycle,selection,title ON assistant_workspace_conversations FOR EACH ROW EXECUTE FUNCTION assistant_workspace_guard_lifecycle();

CREATE OR REPLACE FUNCTION assistant_workspace_guard_new_work() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE conversation_id_to_lock uuid; actor_id_to_lock text; current_lifecycle text;
BEGIN
 IF TG_TABLE_NAME='assistant_workspace_send_reviews' THEN
  IF TG_OP='UPDATE' AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
    AND NEW.revision IS NOT DISTINCT FROM OLD.revision AND NEW.office_snapshot IS NOT DISTINCT FROM OLD.office_snapshot
    AND NEW.raw IS NOT DISTINCT FROM OLD.raw AND NEW.connection_id IS NOT DISTINCT FROM OLD.connection_id
    AND NEW.payment_model IS NOT DISTINCT FROM OLD.payment_model
    AND ((NEW.approved_revision IS NULL AND NEW.approved_by IS NULL AND NEW.approved_at IS NULL)
      OR (NEW.approved_revision IS NOT DISTINCT FROM OLD.approved_revision AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at)) THEN
   -- Tracking completion and approval invalidation are recovery, not new work.
   RETURN NEW;
  END IF;
  SELECT conversation_id,actor_id INTO conversation_id_to_lock,actor_id_to_lock FROM assistant_workspace_drafts WHERE id=NEW.draft_id AND actor_id=NEW.actor_id;
 ELSE
  conversation_id_to_lock := NEW.conversation_id;
  actor_id_to_lock := NEW.actor_id;
  IF TG_OP='INSERT' THEN
   -- Replay of immutable existing rows must still return saved receipts/history.
   IF TG_TABLE_NAME='assistant_workspace_messages' THEN
    IF EXISTS (SELECT 1 FROM assistant_workspace_messages WHERE conversation_id=NEW.conversation_id AND actor_id=NEW.actor_id AND request_key=NEW.request_key AND role=NEW.role) THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='assistant_workspace_runs' THEN
    IF EXISTS (SELECT 1 FROM assistant_workspace_runs WHERE conversation_id=NEW.conversation_id AND actor_id=NEW.actor_id AND request_key=NEW.request_key) THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='assistant_workspace_actions' THEN
    IF EXISTS (SELECT 1 FROM assistant_workspace_actions WHERE conversation_id=NEW.conversation_id AND actor_id=NEW.actor_id AND source_message_id=NEW.source_message_id AND kind=NEW.kind AND target_id=NEW.target_id AND argument_fingerprint=NEW.argument_fingerprint) THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='assistant_workspace_drafts' THEN
    IF EXISTS (SELECT 1 FROM assistant_workspace_drafts WHERE id=NEW.id AND actor_id=NEW.actor_id AND conversation_id=NEW.conversation_id) THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='assistant_workspace_screenshots' THEN
    IF EXISTS (SELECT 1 FROM assistant_workspace_screenshots WHERE id=NEW.id AND actor_id=NEW.actor_id AND conversation_id=NEW.conversation_id AND ready=true) THEN RETURN NEW; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='assistant_workspace_runs' THEN
   IF NEW.status NOT IN ('queued','running') OR NEW.status=OLD.status THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='assistant_workspace_actions' THEN
   IF NEW.status <> 'running' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='assistant_workspace_drafts' THEN
   IF NEW.content IS NOT DISTINCT FROM OLD.content AND NOT (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('local','saving','sending')) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 SELECT lifecycle INTO current_lifecycle FROM assistant_workspace_conversations WHERE id=conversation_id_to_lock AND actor_id=actor_id_to_lock FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ASSISTANT_CONVERSATION_NOT_FOUND'; END IF;
 IF current_lifecycle <> 'active' THEN RAISE EXCEPTION 'ASSISTANT_CONVERSATION_INACTIVE'; END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assistant_workspace_messages_new_work ON assistant_workspace_messages;
CREATE TRIGGER assistant_workspace_messages_new_work BEFORE INSERT ON assistant_workspace_messages FOR EACH ROW EXECUTE FUNCTION assistant_workspace_guard_new_work();
DROP TRIGGER IF EXISTS assistant_workspace_runs_new_work ON assistant_workspace_runs;
CREATE TRIGGER assistant_workspace_runs_new_work BEFORE INSERT OR UPDATE OF status ON assistant_workspace_runs FOR EACH ROW EXECUTE FUNCTION assistant_workspace_guard_new_work();
DROP TRIGGER IF EXISTS assistant_workspace_actions_new_work ON assistant_workspace_actions;
CREATE TRIGGER assistant_workspace_actions_new_work BEFORE INSERT OR UPDATE OF status ON assistant_workspace_actions FOR EACH ROW EXECUTE FUNCTION assistant_workspace_guard_new_work();
DROP TRIGGER IF EXISTS assistant_workspace_drafts_new_work ON assistant_workspace_drafts;
CREATE TRIGGER assistant_workspace_drafts_new_work BEFORE INSERT OR UPDATE OF content,status ON assistant_workspace_drafts FOR EACH ROW EXECUTE FUNCTION assistant_workspace_guard_new_work();
DROP TRIGGER IF EXISTS assistant_workspace_screenshots_new_work ON assistant_workspace_screenshots;
CREATE TRIGGER assistant_workspace_screenshots_new_work BEFORE INSERT ON assistant_workspace_screenshots FOR EACH ROW EXECUTE FUNCTION assistant_workspace_guard_new_work();
DROP TRIGGER IF EXISTS assistant_workspace_send_reviews_new_work ON assistant_workspace_send_reviews;
CREATE TRIGGER assistant_workspace_send_reviews_new_work BEFORE INSERT OR UPDATE ON assistant_workspace_send_reviews FOR EACH ROW EXECUTE FUNCTION assistant_workspace_guard_new_work();
`;
