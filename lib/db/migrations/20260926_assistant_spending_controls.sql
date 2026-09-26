CREATE TABLE IF NOT EXISTS assistant_workspace_spending_settings (
 actor_id text PRIMARY KEY,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 daily_limit_nanos bigint NOT NULL DEFAULT 1000000000 CHECK(daily_limit_nanos BETWEEN 0 AND 1000000000000 AND daily_limit_nanos % 10000000 = 0),
 economy_mode boolean NOT NULL DEFAULT true,
 tracking_started_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE assistant_workspace_spending_settings ADD COLUMN IF NOT EXISTS
 monthly_limit_nanos bigint NOT NULL DEFAULT 30000000000 CHECK(monthly_limit_nanos BETWEEN 0 AND 1000000000000 AND monthly_limit_nanos % 10000000 = 0);
CREATE TABLE IF NOT EXISTS assistant_workspace_spending_calls (
 call_id text PRIMARY KEY,
 actor_id text NOT NULL REFERENCES assistant_workspace_spending_settings(actor_id),
 conversation_id uuid NOT NULL,
 run_id uuid NOT NULL REFERENCES assistant_workspace_runs(id),
 source text NOT NULL CHECK(source IN ('assistant','research','document')),
 model text NOT NULL,
 budget_day date NOT NULL,
 reserved_nanos bigint NOT NULL CHECK(reserved_nanos>0 AND reserved_nanos<=9007199254740991),
 charged_nanos bigint CHECK(charged_nanos>=0 AND charged_nanos<=9007199254740991),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','uncertain','settled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,actor_id) REFERENCES assistant_workspace_conversations(id,actor_id),
 CHECK((state='settled' AND charged_nanos IS NOT NULL) OR (state IN ('reserved','uncertain') AND charged_nanos IS NULL))
);
CREATE INDEX IF NOT EXISTS assistant_workspace_spending_day_idx ON assistant_workspace_spending_calls(actor_id,budget_day);
CREATE INDEX IF NOT EXISTS assistant_workspace_spending_hold_idx ON assistant_workspace_spending_calls(actor_id) WHERE state IN ('reserved','uncertain');
