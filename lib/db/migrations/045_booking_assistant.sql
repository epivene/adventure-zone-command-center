CREATE TABLE IF NOT EXISTS business_knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_key text UNIQUE,
  scope text NOT NULL CHECK (scope IN ('global','package','resource','sales','operations')),
  scope_record_id uuid,
  title text NOT NULL CHECK (nullif(trim(title), '') IS NOT NULL),
  body text NOT NULL CHECK (nullif(trim(body), '') IS NOT NULL),
  source_url text,
  source_label text,
  active boolean NOT NULL DEFAULT true,
  last_reviewed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_knowledge_entries_scope_active_idx
  ON business_knowledge_entries(scope, scope_record_id, active);

CREATE TABLE IF NOT EXISTS derived_crm_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  fact_kind text NOT NULL,
  value jsonb NOT NULL,
  summary text NOT NULL CHECK (nullif(trim(summary), '') IS NOT NULL),
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
  source_activity_id uuid REFERENCES activities(id) ON DELETE SET NULL,
  source_record_id uuid,
  source_version_id uuid,
  extraction_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT derived_crm_facts_parent_required CHECK (
    organization_id IS NOT NULL OR contact_id IS NOT NULL OR booking_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS derived_crm_facts_extraction_fingerprint_unique
  ON derived_crm_facts(extraction_fingerprint);
CREATE INDEX IF NOT EXISTS derived_crm_facts_organization_status_idx
  ON derived_crm_facts(organization_id, status);
CREATE INDEX IF NOT EXISTS derived_crm_facts_contact_status_idx
  ON derived_crm_facts(contact_id, status);
CREATE INDEX IF NOT EXISTS derived_crm_facts_booking_status_idx
  ON derived_crm_facts(booking_id, status);

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  context_kind text NOT NULL CHECK (
    context_kind IN ('organization','contact','event_family','booking','calendar_event','route','call_workspace')
  ),
  context_record_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_conversations_actor_context_idx
  ON assistant_conversations(actor_id, context_kind, context_record_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  body text NOT NULL CHECK (nullif(trim(body), '') IS NOT NULL),
  answer_mode text CHECK (
    answer_mode IS NULL OR answer_mode IN ('deterministic','cloud','offline_cached')
  ),
  confidence text CHECK (
    confidence IS NULL OR confidence IN ('high','medium','low')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_created_idx
  ON assistant_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS assistant_message_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (nullif(trim(source_kind), '') IS NOT NULL),
  source_record_id uuid NOT NULL,
  label text NOT NULL CHECK (nullif(trim(label), '') IS NOT NULL),
  occurred_at timestamptz
);

CREATE INDEX IF NOT EXISTS assistant_message_sources_message_idx
  ON assistant_message_sources(message_id);
