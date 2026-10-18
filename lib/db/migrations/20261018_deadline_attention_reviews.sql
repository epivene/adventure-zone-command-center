-- Presentation-only, append-only review snapshots. No source records or rules change.
CREATE TABLE IF NOT EXISTS deadline_attention_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES deadline_notifications(id),
  follow_up_id uuid NOT NULL REFERENCES follow_ups(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source_kind text NOT NULL,
  source_due_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  review_group text NOT NULL CHECK (review_group IN ('owner','drafts','calls','first_followup','waiting','verification','outdated')),
  next_action text NOT NULL,
  reviewed_on date NOT NULL,
  batch_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,batch_key)
);
CREATE INDEX IF NOT EXISTS deadline_attention_reviews_notice_idx
  ON deadline_attention_reviews(notification_id,created_at DESC,id DESC);
