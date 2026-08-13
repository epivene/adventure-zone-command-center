BEGIN;

CREATE OR REPLACE FUNCTION normalize_north_american_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN btrim(coalesce(value, '')) = '' THEN NULL
    WHEN btrim(value) ~* '(^|[^A-Za-z0-9_])(ext(ension)?[.]?[[:space:]]*[0-9]+|x[[:space:]]*[0-9]+)' THEN NULL
    WHEN regexp_replace(btrim(value), '[^0-9]', '', 'g') ~ '^[0-9]{10}$'
      THEN '+1' || regexp_replace(btrim(value), '[^0-9]', '', 'g')
    WHEN regexp_replace(btrim(value), '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
      THEN '+' || regexp_replace(btrim(value), '[^0-9]', '', 'g')
    ELSE NULL
  END
$$;

DROP TRIGGER IF EXISTS contacts_sync_primary_phone ON contacts;
DROP TRIGGER IF EXISTS contacts_normalize_legacy_phone ON contacts;

UPDATE contact_phones
SET normalized_number = normalize_north_american_phone(number)
WHERE normalized_number IS DISTINCT FROM normalize_north_american_phone(number);

UPDATE contacts
SET normalized_phone = normalize_north_american_phone(phone)
WHERE normalized_phone IS DISTINCT FROM normalize_north_american_phone(phone);

CREATE TEMP TABLE contact_phone_canonical_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    cp.id AS row_id,
    cp.contact_id,
    cp.normalized_number,
    row_number() OVER (
      PARTITION BY cp.contact_id, cp.normalized_number
      ORDER BY
        (cp.number = c.phone) DESC,
        cp."primary" DESC,
        (cp.do_not_call_at IS NOT NULL) DESC,
        (cp.source = 'legacy') DESC,
        cp.created_at,
        cp.id
    ) AS row_rank
  FROM contact_phones cp
  JOIN contacts c ON c.id = cp.contact_id
  WHERE cp.normalized_number IS NOT NULL
), keepers AS (
  SELECT contact_id, normalized_number, row_id AS keeper_id
  FROM ranked
  WHERE row_rank = 1
), merged AS (
  SELECT
    contact_id,
    normalized_number,
    bool_or("primary") AS had_primary,
    min(do_not_call_at) FILTER (WHERE do_not_call_at IS NOT NULL) AS merged_do_not_call_at,
    string_agg(
      DISTINCT nullif(btrim(do_not_call_reason), ''),
      '; ' ORDER BY nullif(btrim(do_not_call_reason), '')
    ) AS merged_do_not_call_reason,
    max(updated_at) AS latest_updated_at
  FROM contact_phones
  WHERE normalized_number IS NOT NULL
  GROUP BY contact_id, normalized_number
  HAVING count(*) > 1
)
SELECT
  ranked.row_id,
  keepers.keeper_id,
  merged.had_primary,
  merged.merged_do_not_call_at,
  merged.merged_do_not_call_reason,
  merged.latest_updated_at
FROM ranked
JOIN keepers USING (contact_id, normalized_number)
JOIN merged USING (contact_id, normalized_number);

UPDATE contact_phones phone
SET "primary" = false
FROM contact_phone_canonical_merge merge
WHERE phone.id = merge.row_id
  AND merge.row_id <> merge.keeper_id
  AND phone."primary";

UPDATE contact_phones phone
SET "primary" = merge.had_primary,
    do_not_call_at = coalesce(merge.merged_do_not_call_at, phone.do_not_call_at),
    do_not_call_reason = coalesce(merge.merged_do_not_call_reason, phone.do_not_call_reason),
    updated_at = greatest(phone.updated_at, merge.latest_updated_at)
FROM (
  SELECT DISTINCT
    keeper_id,
    had_primary,
    merged_do_not_call_at,
    merged_do_not_call_reason,
    latest_updated_at
  FROM contact_phone_canonical_merge
) merge
WHERE phone.id = merge.keeper_id;

UPDATE call_sessions sessions
SET phone_id = merge.keeper_id
FROM contact_phone_canonical_merge merge
WHERE merge.row_id <> merge.keeper_id
  AND sessions.phone_id = merge.row_id;

DELETE FROM contact_phones phone
USING contact_phone_canonical_merge merge
WHERE phone.id = merge.row_id
  AND merge.row_id <> merge.keeper_id;

UPDATE contact_phones phone
SET "primary" = false,
    updated_at = contacts.updated_at
FROM contacts
WHERE phone.contact_id = contacts.id
  AND phone."primary"
  AND btrim(coalesce(contacts.phone, '')) = '';

DO $$
DECLARE
  contact_row record;
  canonical_number text;
  matching_phone_id uuid;
BEGIN
  FOR contact_row IN
    SELECT id, phone, created_at, updated_at
    FROM contacts
    WHERE btrim(coalesce(phone, '')) <> ''
    ORDER BY id
  LOOP
    canonical_number := normalize_north_american_phone(contact_row.phone);
    matching_phone_id := NULL;

    IF canonical_number IS NOT NULL THEN
      SELECT id INTO matching_phone_id
      FROM contact_phones
      WHERE contact_id = contact_row.id
        AND normalized_number = canonical_number
      ORDER BY (do_not_call_at IS NOT NULL) DESC, "primary" DESC,
               (source = 'legacy') DESC, created_at, id
      LIMIT 1;
    END IF;

    IF matching_phone_id IS NULL THEN
      SELECT id INTO matching_phone_id
      FROM contact_phones
      WHERE contact_id = contact_row.id
        AND number = contact_row.phone
      ORDER BY (do_not_call_at IS NOT NULL) DESC, "primary" DESC,
               (source = 'legacy') DESC, created_at, id
      LIMIT 1;
    END IF;

    UPDATE contact_phones
    SET "primary" = false,
        updated_at = contact_row.updated_at
    WHERE contact_id = contact_row.id
      AND "primary"
      AND id IS DISTINCT FROM matching_phone_id;

    IF matching_phone_id IS NULL THEN
      INSERT INTO contact_phones (
        contact_id, number, normalized_number, type, "primary", source,
        created_at, updated_at
      ) VALUES (
        contact_row.id, contact_row.phone, canonical_number, 'unknown', true,
        'legacy', contact_row.created_at, contact_row.updated_at
      );
    ELSE
      UPDATE contact_phones
      SET number = contact_row.phone,
          normalized_number = canonical_number,
          "primary" = true,
          updated_at = contact_row.updated_at
      WHERE id = matching_phone_id;
    END IF;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_contact_normalized_number_unique
  ON contact_phones (contact_id, normalized_number)
  WHERE normalized_number IS NOT NULL;

CREATE OR REPLACE FUNCTION normalize_contact_legacy_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_phone := normalize_north_american_phone(NEW.phone);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_contact_primary_phone_from_legacy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_number text := normalize_north_american_phone(NEW.phone);
  matching_phone_id uuid;
BEGIN
  IF btrim(coalesce(NEW.phone, '')) = '' THEN
    UPDATE contact_phones
    SET "primary" = false,
        updated_at = NEW.updated_at
    WHERE contact_id = NEW.id
      AND "primary";
    RETURN NEW;
  END IF;

  IF canonical_number IS NOT NULL THEN
    SELECT id INTO matching_phone_id
    FROM contact_phones
    WHERE contact_id = NEW.id
      AND normalized_number = canonical_number
    ORDER BY (do_not_call_at IS NOT NULL) DESC, "primary" DESC,
             (source = 'legacy') DESC, created_at, id
    LIMIT 1;
  END IF;

  IF matching_phone_id IS NULL THEN
    SELECT id INTO matching_phone_id
    FROM contact_phones
    WHERE contact_id = NEW.id
      AND number = NEW.phone
    ORDER BY (do_not_call_at IS NOT NULL) DESC, "primary" DESC,
             (source = 'legacy') DESC, created_at, id
    LIMIT 1;
  END IF;

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
      NEW.id, NEW.phone, canonical_number, 'unknown', true, 'legacy',
      NEW.created_at, NEW.updated_at
    );
  ELSE
    UPDATE contact_phones
    SET number = NEW.phone,
        normalized_number = canonical_number,
        "primary" = true,
        updated_at = NEW.updated_at
    WHERE id = matching_phone_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_normalize_legacy_phone
BEFORE INSERT OR UPDATE OF phone, normalized_phone ON contacts
FOR EACH ROW
EXECUTE FUNCTION normalize_contact_legacy_phone();

CREATE TRIGGER contacts_sync_primary_phone
AFTER INSERT OR UPDATE OF phone, normalized_phone ON contacts
FOR EACH ROW
EXECUTE FUNCTION sync_contact_primary_phone_from_legacy();

COMMIT;
