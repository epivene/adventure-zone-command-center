INSERT INTO contract_templates (
  stable_key,
  version,
  state,
  created_by,
  effective_at
) VALUES (
  'adventure-zone-standard',
  1,
  'active',
  'contract-rollout-v1',
  now()
)
ON CONFLICT (stable_key, version) DO UPDATE
SET
  state = 'active',
  effective_at = COALESCE(contract_templates.effective_at, now())
WHERE contract_templates.state IN ('draft', 'reviewed');
