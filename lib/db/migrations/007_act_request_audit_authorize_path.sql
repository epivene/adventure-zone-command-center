DO $$
BEGIN
  IF to_regclass('act_replacement_request_audits') IS NOT NULL THEN
    ALTER TABLE act_replacement_request_audits
      DROP CONSTRAINT IF EXISTS act_replacement_request_audits_path_template_safe;
    ALTER TABLE act_replacement_request_audits
      ADD CONSTRAINT act_replacement_request_audits_path_template_safe
      CHECK (
        path_template = '/authorize'
        OR path_template ~ '^/api/[A-Za-z0-9_{}:-]+(/[A-Za-z0-9_{}:-]+)*$'
      );
  END IF;
END $$;
