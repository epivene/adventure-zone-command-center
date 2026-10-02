-- Additive only: canonical booking dates and imported snapshots are never rewritten.
CREATE TABLE IF NOT EXISTS booking_date_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  field text NOT NULL CHECK (field IN ('public_start','public_end','reservation_start','reservation_end')),
  kind text NOT NULL CHECK (kind IN ('verified_event','verified_reservation','sales_milestone','unknown_import','unresolved_conflict')),
  value text, semantics text NOT NULL CHECK (semantics IN ('instant','inclusive_date','exclusive_date')),
  revision integer NOT NULL CHECK (revision > 0),
  source_type text NOT NULL, source_id text NOT NULL, source_revision text NOT NULL,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_date_evidence_identity UNIQUE(booking_id,field,revision,source_type,source_id,source_revision)
);
CREATE INDEX IF NOT EXISTS booking_date_evidence_current ON booking_date_evidence(booking_id,field,revision DESC);
CREATE TABLE IF NOT EXISTS booking_date_repair_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  actor text NOT NULL, fingerprint text NOT NULL, payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS booking_date_repair_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  preview_id uuid NOT NULL REFERENCES booking_date_repair_previews(id),
  actor text NOT NULL, request_key text NOT NULL, request_fingerprint text NOT NULL,
  before_values jsonb NOT NULL, after_values jsonb NOT NULL, source_references jsonb NOT NULL,
  reason text NOT NULL, impacts jsonb NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_date_repair_request_identity UNIQUE(actor,request_key)
);
CREATE OR REPLACE FUNCTION booking_date_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BOOKING_DATE_HISTORY_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS booking_date_evidence_immutable ON booking_date_evidence;
CREATE TRIGGER booking_date_evidence_immutable BEFORE UPDATE OR DELETE ON booking_date_evidence FOR EACH ROW EXECUTE FUNCTION booking_date_history_immutable();
DROP TRIGGER IF EXISTS booking_date_receipt_immutable ON booking_date_repair_receipts;
CREATE TRIGGER booking_date_receipt_immutable BEFORE UPDATE OR DELETE ON booking_date_repair_receipts FOR EACH ROW EXECUTE FUNCTION booking_date_history_immutable();

CREATE OR REPLACE FUNCTION booking_date_value(v text, semantics text, field_name text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result timestamptz; day_value date;
BEGIN
  IF v IS NULL OR substring(v,1,4)::integer < 1 OR substring(v,1,4)::integer >= 9999 THEN RETURN NULL; END IF;
  IF semantics='instant' THEN
    IF v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' THEN RETURN NULL; END IF;
    result := v::timestamptz;
  ELSE
    IF v !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
    day_value := v::date;
    result := day_value::timestamp AT TIME ZONE 'America/Denver';
    IF field_name LIKE '%_end' AND semantics='inclusive_date' THEN
      result := (day_value+1)::timestamp AT TIME ZONE 'America/Denver';
      result := result - interval '1 millisecond';
    END IF;
  END IF;
  IF extract(year from result AT TIME ZONE 'UTC') < 1 OR extract(year from result AT TIME ZONE 'UTC') >= 9999 THEN RETURN NULL; END IF;
  RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION booking_date_iso(v timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(v AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE OR REPLACE FUNCTION booking_date_endpoint(booking uuid, field_name text, raw_value timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE evidence record; expected_kind text; latest_revision integer; value_count integer; resolved_value timestamptz;
BEGIN
  IF raw_value IS NULL OR extract(year from raw_value AT TIME ZONE 'UTC') NOT BETWEEN 1 AND 9998 THEN RETURN NULL; END IF;
  SELECT max(revision) INTO latest_revision FROM booking_date_evidence WHERE booking_id=booking AND field=field_name;
  SELECT count(DISTINCT jsonb_build_object('value',booking_date_value(value,semantics,field),'semantics',semantics,'kind',kind))
  INTO value_count FROM booking_date_evidence WHERE booking_id=booking AND field=field_name AND revision=latest_revision;
  IF value_count<>1 THEN RETURN NULL; END IF;
  SELECT * INTO evidence FROM booking_date_evidence WHERE booking_id=booking AND field=field_name AND revision=latest_revision LIMIT 1;
  expected_kind := CASE WHEN field_name LIKE 'public_%' THEN 'verified_event' ELSE 'verified_reservation' END;
  resolved_value := booking_date_value(evidence.value,evidence.semantics,field_name);
  IF evidence.kind IS DISTINCT FROM expected_kind OR resolved_value IS NULL THEN RETURN NULL; END IF;
  IF resolved_value IS DISTINCT FROM raw_value AND NOT (
    evidence.semantics<>'instant' AND (raw_value AT TIME ZONE 'UTC')::time=time '00:00:00'
    AND to_char(raw_value AT TIME ZONE 'UTC','YYYY-MM-DD')=evidence.value
  ) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('value',booking_date_iso(resolved_value),'exclusive',evidence.semantics='exclusive_date');
END $$;
CREATE OR REPLACE FUNCTION booking_resolved_dates(booking uuid, ps timestamptz, pe timestamptz, rs timestamptz, re timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE pstart jsonb; pend jsonb; rstart jsonb; rend jsonb; public_window jsonb; reservation_window jsonb;
  reasons jsonb := '[]'::jsonb; reservation_present boolean;
BEGIN
  pstart := booking_date_endpoint(booking,'public_start',ps);
  pend := booking_date_endpoint(booking,'public_end',pe);
  rstart := booking_date_endpoint(booking,'reservation_start',rs);
  rend := booking_date_endpoint(booking,'reservation_end',re);
  reservation_present := rs IS NOT NULL OR re IS NOT NULL OR EXISTS(SELECT 1 FROM booking_date_evidence WHERE booking_id=booking AND field LIKE 'reservation_%');
  IF pstart IS NULL OR pend IS NULL THEN reasons := reasons || '["INCOMPLETE_PUBLIC_WINDOW"]'::jsonb;
  ELSIF (pstart->>'value')::timestamptz>(pend->>'value')::timestamptz OR (pstart->>'value'=pend->>'value' AND (pend->>'exclusive')::boolean) THEN reasons := reasons || '["REVERSED_PUBLIC_WINDOW"]'::jsonb;
  ELSE public_window := jsonb_build_object('start',pstart->>'value','end',pend->>'value'); END IF;
  IF rstart IS NULL OR rend IS NULL THEN
    IF reservation_present THEN reasons := reasons || '["INCOMPLETE_RESERVATION_WINDOW"]'::jsonb; END IF;
  ELSIF (rstart->>'value')::timestamptz>(rend->>'value')::timestamptz OR (rstart->>'value'=rend->>'value' AND (rend->>'exclusive')::boolean) THEN reasons := reasons || '["REVERSED_RESERVATION_WINDOW"]'::jsonb;
  ELSE reservation_window := jsonb_build_object('start',rstart->>'value','end',rend->>'value'); END IF;
  RETURN jsonb_build_object('rawPublic',jsonb_build_object('start',booking_date_iso(ps),'end',booking_date_iso(pe)),
    'rawReservation',jsonb_build_object('start',booking_date_iso(rs),'end',booking_date_iso(re)),
    'publicWindow',public_window,'reservationWindow',reservation_window,
    'verifiedPublicStart',pstart->>'value',
    'publicEndExclusive',coalesce((pend->>'exclusive')::boolean,false),
    'reservationEndExclusive',coalesce((rend->>'exclusive')::boolean,false),
    'evidenceState',CASE WHEN jsonb_array_length(reasons)>0 THEN 'needs_review' ELSE 'verified' END,'reviewReasons',reasons,
    'endpointEvidence',coalesce((SELECT jsonb_agg(jsonb_build_object('field',e.field,'kind',e.kind,'value',e.value,'semantics',e.semantics,'revision',e.revision,
      'sourceRef',jsonb_build_object('type',e.source_type,'id',e.source_id,'revision',e.source_revision)) ORDER BY e.field,e.source_type,e.source_id)
      FROM booking_date_evidence e WHERE e.booking_id=booking AND e.revision=(SELECT max(c.revision) FROM booking_date_evidence c WHERE c.booking_id=e.booking_id AND c.field=e.field)),'[]'::jsonb));
END $$;
