-- Apply with rollout disabled; independently repairs missing objects. Never expires an uncertain provider outcome.
CREATE TABLE IF NOT EXISTS outreach_offer_approvals (draft_kind text NOT NULL,
draft_id uuid NOT NULL,
digest text NOT NULL,
intent text NOT NULL,
hold_id uuid,
hold_revision integer,
stage text,
actor text NOT NULL,
reason text NOT NULL,
approved_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS draft_kind text NOT NULL;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS draft_id uuid NOT NULL;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS digest text NOT NULL;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS intent text NOT NULL;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS hold_id uuid;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS hold_revision integer;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS actor text NOT NULL;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS reason text NOT NULL;
ALTER TABLE outreach_offer_approvals ADD COLUMN IF NOT EXISTS approved_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_offer_approvals'::regclass AND conname='outreach_offer_approvals_pkey') THEN ALTER TABLE outreach_offer_approvals ADD CONSTRAINT outreach_offer_approvals_pkey PRIMARY KEY(draft_kind,draft_id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_offer_approvals'::regclass AND conname='outreach_offer_intent_check') THEN ALTER TABLE outreach_offer_approvals ADD CONSTRAINT outreach_offer_intent_check CHECK(intent IN ('exploratory','administrative','specific_offer')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_offer_approvals'::regclass AND conname='outreach_offer_kind_check') THEN ALTER TABLE outreach_offer_approvals ADD CONSTRAINT outreach_offer_kind_check CHECK(draft_kind IN ('opportunity_email','office_email')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_offer_approvals'::regclass AND conname='outreach_offer_hold_check') THEN ALTER TABLE outreach_offer_approvals ADD CONSTRAINT outreach_offer_hold_check CHECK((intent='specific_offer')=(hold_id IS NOT NULL AND hold_revision IS NOT NULL)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_offer_approvals'::regclass AND conname='outreach_offer_hold_fk') THEN ALTER TABLE outreach_offer_approvals ADD CONSTRAINT outreach_offer_hold_fk FOREIGN KEY(hold_id) REFERENCES outreach_holds(id); END IF; END $$;
CREATE TABLE IF NOT EXISTS outreach_dispatches (id uuid NOT NULL DEFAULT gen_random_uuid(),
draft_kind text NOT NULL,
draft_id uuid NOT NULL,
hold_id uuid,
hold_revision integer,
digest text NOT NULL,
intent text NOT NULL,
stage text,
payload jsonb NOT NULL,
state text NOT NULL DEFAULT 'dispatching',
confirmation jsonb,
last_error text,
review_after timestamptz NOT NULL,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS draft_kind text NOT NULL;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS draft_id uuid NOT NULL;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS hold_id uuid;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS hold_revision integer;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS digest text NOT NULL;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS intent text NOT NULL;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'dispatching';
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS confirmation jsonb;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS review_after timestamptz NOT NULL;
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_dispatches'::regclass AND conname='outreach_dispatches_pkey') THEN ALTER TABLE outreach_dispatches ADD CONSTRAINT outreach_dispatches_pkey PRIMARY KEY(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_dispatches'::regclass AND conname='outreach_dispatch_state_check') THEN ALTER TABLE outreach_dispatches ADD CONSTRAINT outreach_dispatch_state_check CHECK(state IN ('dispatching','uncertain','sent','not_sent')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_dispatches'::regclass AND conname='outreach_dispatch_hold_fk') THEN ALTER TABLE outreach_dispatches ADD CONSTRAINT outreach_dispatch_hold_fk FOREIGN KEY(hold_id) REFERENCES outreach_holds(id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_dispatches'::regclass AND conname='outreach_dispatch_confirmed_check') THEN ALTER TABLE outreach_dispatches ADD CONSTRAINT outreach_dispatch_confirmed_check CHECK(state <> 'sent' OR confirmation IS NOT NULL); END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS outreach_dispatch_one_delivery ON outreach_dispatches(draft_kind,draft_id) WHERE state <> 'not_sent';
CREATE INDEX IF NOT EXISTS outreach_dispatch_unresolved_hold ON outreach_dispatches(hold_id) WHERE state IN ('dispatching','uncertain');
CREATE OR REPLACE FUNCTION outreach_guard_dispatch_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('outreach.enforced',true) IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM outreach_write_receipts WHERE transaction_id=txid_current()) THEN RAISE EXCEPTION 'Dispatch requires allocation transaction participation.' USING ERRCODE='23514'; END IF;
 UPDATE outreach_write_receipts SET dirty=true,validated=false WHERE transaction_id=txid_current();
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS outreach_dispatch_guard ON outreach_dispatches;
CREATE TRIGGER outreach_dispatch_guard AFTER INSERT OR UPDATE OR DELETE ON outreach_dispatches FOR EACH ROW EXECUTE FUNCTION outreach_guard_dispatch_write();
CREATE OR REPLACE FUNCTION outreach_hold_dispatch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('outreach.enforced',true) IS DISTINCT FROM 'true' THEN RETURN NEW; END IF;
 -- Expiry retains its real stored semantics; the unresolved dispatch independently blocks allocation.
 IF NEW.state='expired' AND NEW.expires_at=OLD.expires_at THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM outreach_dispatches WHERE hold_id=OLD.id AND state IN ('dispatching','uncertain')) THEN RAISE EXCEPTION 'Reconcile unresolved delivery before changing or converting its hold.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outreach_hold_delivery_guard ON outreach_holds;
CREATE TRIGGER outreach_hold_delivery_guard BEFORE UPDATE ON outreach_holds FOR EACH ROW EXECUTE FUNCTION outreach_hold_dispatch_guard();
CREATE OR REPLACE FUNCTION outreach_draft_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW) - ARRAY['outreach_content_revision','state','updated_at','sent_at','scheduled_for','send_request_key','schedule_request_key','dispatch_lease_owner','dispatch_lease_expires_at','dispatch_attempt_count','gmail_message_id','sent_message_id','last_failure_code','last_failure_message','last_send_error','submitted_at','owner_return_note'])
 IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['outreach_content_revision','state','updated_at','sent_at','scheduled_for','send_request_key','schedule_request_key','dispatch_lease_owner','dispatch_lease_expires_at','dispatch_attempt_count','gmail_message_id','sent_message_id','last_failure_code','last_failure_message','last_send_error','submitted_at','owner_return_note']) THEN
 NEW.outreach_content_revision := OLD.outreach_content_revision+1;
 ELSE NEW.outreach_content_revision := OLD.outreach_content_revision; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['booking_opportunity_email_state','office_email_drafts'] LOOP
 IF to_regclass(target) IS NOT NULL THEN
 EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS outreach_content_revision bigint NOT NULL DEFAULT 1',target);
 EXECUTE format('DROP TRIGGER IF EXISTS outreach_draft_content_revision ON %I',target);
 EXECUTE format('CREATE TRIGGER outreach_draft_content_revision BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION outreach_draft_revision()',target);
 END IF;
 END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS outreach_inbound_observations (id uuid NOT NULL DEFAULT gen_random_uuid(),
message_id text NOT NULL,
thread_id text NOT NULL,
organization_id uuid NOT NULL,
opportunity_id uuid,
event_year integer,
received_at timestamptz,
metadata jsonb NOT NULL,
state text NOT NULL DEFAULT 'needs_review',
classification text,
reviewed_opportunity_id uuid,
reviewed_at timestamptz,
actor text,
reason text,
source_reference text);
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS message_id text NOT NULL;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS thread_id text NOT NULL;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS organization_id uuid NOT NULL;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS opportunity_id uuid;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS event_year integer;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'needs_review';
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS classification text;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS reviewed_opportunity_id uuid;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS actor text;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE outreach_inbound_observations ADD COLUMN IF NOT EXISTS source_reference text;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_inbound_observations'::regclass AND conname='outreach_inbound_pkey') THEN ALTER TABLE outreach_inbound_observations ADD CONSTRAINT outreach_inbound_pkey PRIMARY KEY(id); END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS outreach_inbound_message_identity ON outreach_inbound_observations(message_id,organization_id);
CREATE INDEX IF NOT EXISTS outreach_inbound_review ON outreach_inbound_observations(organization_id) WHERE state='needs_review';

ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS verification jsonb;

CREATE TABLE IF NOT EXISTS outreach_source_reviews (candidate_id uuid NOT NULL,
source_id text NOT NULL,
classification text NOT NULL,
occurred_at timestamptz NOT NULL,
actor text NOT NULL,
reason text NOT NULL,
reviewed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE outreach_source_reviews ADD COLUMN IF NOT EXISTS candidate_id uuid NOT NULL;
ALTER TABLE outreach_source_reviews ADD COLUMN IF NOT EXISTS source_id text NOT NULL;
ALTER TABLE outreach_source_reviews ADD COLUMN IF NOT EXISTS classification text NOT NULL;
ALTER TABLE outreach_source_reviews ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL;
ALTER TABLE outreach_source_reviews ADD COLUMN IF NOT EXISTS actor text NOT NULL;
ALTER TABLE outreach_source_reviews ADD COLUMN IF NOT EXISTS reason text NOT NULL;
ALTER TABLE outreach_source_reviews ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_source_reviews'::regclass AND conname='outreach_source_reviews_pkey') THEN ALTER TABLE outreach_source_reviews ADD CONSTRAINT outreach_source_reviews_pkey PRIMARY KEY(candidate_id,source_id); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='outreach_source_reviews'::regclass AND conname='outreach_source_review_classification') THEN ALTER TABLE outreach_source_reviews ADD CONSTRAINT outreach_source_review_classification CHECK(classification IN ('additional_attempt','not_cadence')); END IF; END $$;

ALTER TABLE outreach_dispatches ADD COLUMN IF NOT EXISTS tracking_state text NOT NULL DEFAULT 'pending';
