export const assistantWorkspaceProfileTasksSql = `
CREATE TABLE IF NOT EXISTS assistant_profile_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL, conversation_id uuid NOT NULL,
 source_message_id uuid NOT NULL REFERENCES assistant_workspace_messages(id), request_key text NOT NULL,
 scope jsonb NOT NULL, authority jsonb NOT NULL,
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','running','paused','waiting_review','completed','cancelled')),
 version integer NOT NULL DEFAULT 1, pause_reason text,
 lease_token integer NOT NULL DEFAULT 0, lease_expires_at timestamptz, worker_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id),
 UNIQUE(actor_id,conversation_id,request_key), UNIQUE(id,actor_id)
);
CREATE TABLE IF NOT EXISTS assistant_profile_task_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES assistant_profile_tasks(id),
 profile_id uuid NOT NULL,event_year integer,profile_name_snapshot text NOT NULL DEFAULT 'Unavailable profile',
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','researching','ready_to_save','awaiting_review','completed','needs_review','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0, reason text,
 evidence_ids jsonb NOT NULL DEFAULT '[]',receipt_ids jsonb NOT NULL DEFAULT '[]',action_ids jsonb NOT NULL DEFAULT '[]',
 ordinal integer NOT NULL, UNIQUE(task_id,profile_id), UNIQUE(task_id,ordinal)
);
ALTER TABLE assistant_profile_task_items ADD COLUMN IF NOT EXISTS profile_name_snapshot text NOT NULL DEFAULT 'Unavailable profile';
CREATE TABLE IF NOT EXISTS assistant_profile_task_runs (
 task_id uuid NOT NULL REFERENCES assistant_profile_tasks(id), run_id uuid NOT NULL UNIQUE REFERENCES assistant_workspace_runs(id),
 batch_number integer NOT NULL, item_ids jsonb NOT NULL, settled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(task_id,batch_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_profile_task_active_batch ON assistant_profile_task_runs(task_id) WHERE NOT settled;
CREATE TABLE IF NOT EXISTS assistant_profile_task_commands (task_id uuid NOT NULL REFERENCES assistant_profile_tasks(id), request_key text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(task_id,request_key));
CREATE TABLE IF NOT EXISTS assistant_profile_task_evidence(task_id uuid NOT NULL,profile_id uuid NOT NULL,evidence_id text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(task_id,profile_id,evidence_id),FOREIGN KEY(task_id,profile_id) REFERENCES assistant_profile_task_items(task_id,profile_id));
CREATE TABLE IF NOT EXISTS assistant_profile_task_change_evidence(task_id uuid NOT NULL,profile_id uuid NOT NULL,kind text NOT NULL,fingerprint text NOT NULL,arguments jsonb NOT NULL,evidence_ids jsonb NOT NULL,PRIMARY KEY(task_id,profile_id,kind,fingerprint),FOREIGN KEY(task_id,profile_id) REFERENCES assistant_profile_task_items(task_id,profile_id));
CREATE INDEX IF NOT EXISTS assistant_profile_task_owner ON assistant_profile_tasks(actor_id,conversation_id);
`;
