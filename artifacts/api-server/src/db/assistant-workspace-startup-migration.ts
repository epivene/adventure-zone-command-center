import { assistantWorkspaceProfileTasksSql } from "./assistant-workspace-profile-tasks";
import { assistantWorkspaceLifecycleSql } from "./assistant-workspace-lifecycle";
import { assistantWorkspaceSpendingSql } from "./assistant-workspace-spending";
export const assistantWorkspaceSql = `CREATE TABLE IF NOT EXISTS assistant_workspace_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL,
 title text NOT NULL, selection jsonb NOT NULL,
 summary jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,actor_id)
);
ALTER TABLE assistant_workspace_conversations ADD COLUMN IF NOT EXISTS summary jsonb NOT NULL DEFAULT '{}';
ALTER TABLE assistant_workspace_conversations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS assistant_workspace_conversation_owner_idx ON assistant_workspace_conversations(actor_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS assistant_workspace_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL,
 actor_id text NOT NULL, sequence bigint GENERATED ALWAYS AS IDENTITY,
 request_key text NOT NULL, role text NOT NULL CHECK(role IN ('user','assistant')),
 body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id),
 UNIQUE(conversation_id,request_key,role)
);
CREATE INDEX IF NOT EXISTS assistant_workspace_message_order_idx ON assistant_workspace_messages(conversation_id,sequence);
ALTER TABLE assistant_workspace_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS assistant_workspace_screenshots (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL, actor_id text NOT NULL,
 filename text NOT NULL, content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
 byte_size integer NOT NULL CHECK(byte_size>0 AND byte_size<=5242880), sha256 text NOT NULL, object_key text NOT NULL UNIQUE,
 ready boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id)
);
CREATE INDEX IF NOT EXISTS assistant_workspace_screenshot_owner_idx ON assistant_workspace_screenshots(actor_id,conversation_id);
CREATE TABLE IF NOT EXISTS assistant_workspace_actions (
 id uuid PRIMARY KEY,conversation_id uuid NOT NULL,actor_id text NOT NULL,
 kind text NOT NULL,target_id text NOT NULL,expected_revision text,connection_id text,
 arguments jsonb NOT NULL,argument_fingerprint text NOT NULL,source_message_id uuid NOT NULL REFERENCES assistant_workspace_messages(id),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','running','provider_started','uncertain','succeeded','failed','cancelled')),
 result jsonb,worker_id text,lease_token integer NOT NULL DEFAULT 0,lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id),
 UNIQUE(actor_id,source_message_id,kind,target_id,argument_fingerprint)
);
CREATE INDEX IF NOT EXISTS assistant_workspace_action_owner_idx ON assistant_workspace_actions(actor_id,conversation_id,created_at);
CREATE TABLE IF NOT EXISTS assistant_workspace_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL,actor_id text NOT NULL,
 request_key text NOT NULL,source_message_id uuid NOT NULL REFERENCES assistant_workspace_messages(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting','succeeded','partial','failed','cancelled')),
 checkpoint jsonb NOT NULL DEFAULT '{}',worker_id text,lease_token integer NOT NULL DEFAULT 0,
 lease_expires_at timestamptz,cancel_requested_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id),
 UNIQUE(conversation_id,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_workspace_one_active_run_idx ON assistant_workspace_runs(conversation_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS assistant_workspace_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES assistant_workspace_runs(id),actor_id text NOT NULL,
 kind text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_workspace_event_run_idx ON assistant_workspace_events(run_id,sequence);
CREATE TABLE IF NOT EXISTS assistant_workspace_rule_heads (
 scope_key text PRIMARY KEY,version integer NOT NULL DEFAULT 0,current_id uuid
);
CREATE TABLE IF NOT EXISTS assistant_workspace_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope_key text NOT NULL REFERENCES assistant_workspace_rule_heads(scope_key),
 rule_key text NOT NULL,version integer,body text NOT NULL,source_label text NOT NULL,
 organization_id uuid,event_year integer,effective_from date NOT NULL,effective_to date,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','superseded')),
 supersedes_id uuid REFERENCES assistant_workspace_rules(id),proposed_by text NOT NULL,
 approved_by text,reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(scope_key,version),CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE IF NOT EXISTS assistant_workspace_drafts (
 id uuid PRIMARY KEY,actor_id text NOT NULL,conversation_id uuid NOT NULL,content jsonb NOT NULL,revision text NOT NULL,
 status text NOT NULL DEFAULT 'local' CHECK(status IN ('local','saving','saved','sending','uncertain','sent')),
 gmail_draft_id text,gmail_hash text,connection_id text,message_id text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id)
);
CREATE TABLE IF NOT EXISTS assistant_workspace_mutation_results (
 action_id uuid PRIMARY KEY REFERENCES assistant_workspace_actions(id),actor_id text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assistant_workspace_send_reviews (
 draft_id uuid PRIMARY KEY REFERENCES assistant_workspace_drafts(id),actor_id text NOT NULL,revision text NOT NULL,
 office_snapshot jsonb NOT NULL,raw text NOT NULL,connection_id text NOT NULL,
 payment_model text NOT NULL CHECK(payment_model IN ('prepaid','pay_per_play','administrative')),
 approved_revision text,approved_by text,approved_at timestamptz,tracking_complete boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assistant_workspace_drafts DROP CONSTRAINT IF EXISTS assistant_workspace_drafts_status_check;
ALTER TABLE assistant_workspace_drafts ADD CONSTRAINT assistant_workspace_drafts_status_check CHECK(status IN ('local','saving','saved','sending','uncertain','sent'));
CREATE TABLE IF NOT EXISTS assistant_workspace_campaign_batches (
 id uuid PRIMARY KEY, actor_id text NOT NULL, conversation_id uuid NOT NULL,
 source_message_id uuid NOT NULL REFERENCES assistant_workspace_messages(id),
 title text NOT NULL,event_year integer NOT NULL CHECK(event_year BETWEEN 2000 AND 2200),criteria text NOT NULL,
 input_fingerprint text NOT NULL,members jsonb NOT NULL CHECK(jsonb_array_length(members) BETWEEN 1 AND 100),
 revision integer NOT NULL DEFAULT 1,cursor integer NOT NULL DEFAULT 0 CHECK(cursor BETWEEN 0 AND 100),
 draft_links jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id),
 UNIQUE(actor_id,conversation_id,source_message_id)
);
CREATE TABLE IF NOT EXISTS assistant_workspace_campaign_pages (
 batch_id uuid NOT NULL REFERENCES assistant_workspace_campaign_batches(id),
 source_message_id uuid NOT NULL REFERENCES assistant_workspace_messages(id),request_fingerprint text NOT NULL,
 start_index integer NOT NULL,end_index integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,source_message_id)
);
CREATE TABLE IF NOT EXISTS assistant_workspace_research_calls (
 id uuid PRIMARY KEY,actor_id text NOT NULL,conversation_id uuid NOT NULL,run_id uuid NOT NULL REFERENCES assistant_workspace_runs(id),
 call_id text NOT NULL,input_fingerprint text NOT NULL,state text NOT NULL CHECK(state IN ('started','completed')),result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id), UNIQUE(run_id,call_id)
);
CREATE TABLE IF NOT EXISTS assistant_workspace_document_extractions (
 cache_key text PRIMARY KEY,actor_id text NOT NULL,run_id uuid NOT NULL REFERENCES assistant_workspace_runs(id),call_id text,
 state text NOT NULL CHECK(state IN ('started','completed')),result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
`;
export async function ensureAssistantWorkspaceSchema(db: {
  query(sql: string): Promise<unknown>;
  exec?(sql: string): Promise<unknown>;
}) {
  if (db.exec)
    await db.exec(
      assistantWorkspaceSql +
        assistantWorkspaceLifecycleSql +
        assistantWorkspaceSpendingSql +
        assistantWorkspaceProfileTasksSql,
    );
  else
    await db.query(
      assistantWorkspaceSql +
        assistantWorkspaceLifecycleSql +
        assistantWorkspaceSpendingSql +
        assistantWorkspaceProfileTasksSql,
    );
}
