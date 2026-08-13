BEGIN;

CREATE OR REPLACE FUNCTION sync_contact_primary_phone_from_legacy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matching_phone_id uuid;
BEGIN
  IF btrim(coalesce(NEW.phone, '')) = '' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO matching_phone_id
  FROM contact_phones
  WHERE contact_id = NEW.id
    AND number = NEW.phone
  ORDER BY (do_not_call_at IS NOT NULL) DESC, created_at, id
  LIMIT 1;

  UPDATE contact_phones
  SET "primary" = false,
      updated_at = NEW.updated_at
  WHERE contact_id = NEW.id
    AND "primary"
    AND id IS DISTINCT FROM matching_phone_id;

  IF matching_phone_id IS NULL THEN
    INSERT INTO contact_phones (
      contact_id, number, normalized_number, type, "primary", source,
      created_at, updated_at
    ) VALUES (
      NEW.id, NEW.phone, NEW.normalized_phone, 'unknown', true, 'legacy',
      NEW.created_at, NEW.updated_at
    );
  ELSE
    UPDATE contact_phones
    SET normalized_number = NEW.normalized_phone,
        "primary" = true,
        updated_at = NEW.updated_at
    WHERE id = matching_phone_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_sync_primary_phone ON contacts;
CREATE TRIGGER contacts_sync_primary_phone
AFTER INSERT OR UPDATE OF phone, normalized_phone ON contacts
FOR EACH ROW
EXECUTE FUNCTION sync_contact_primary_phone_from_legacy();

COMMIT;
