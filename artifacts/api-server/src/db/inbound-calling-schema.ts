// Read only: installed schemas must not acquire table-altering locks on startup.
export const inboundCallingSchemaReadySql = `SELECT
  NOT EXISTS (
    SELECT 1 FROM (VALUES
    ('inbound_call_sessions', 'id'),
    ('inbound_call_sessions', 'owner_id'),
    ('inbound_call_sessions', 'provider_parent_call_sid'),
    ('inbound_call_sessions', 'provider_browser_call_sid'),
    ('inbound_call_sessions', 'provider'),
    ('inbound_call_sessions', 'direction'),
    ('inbound_call_sessions', 'method'),
    ('inbound_call_sessions', 'ingress_number_snapshot'),
    ('inbound_call_sessions', 'caller_number_snapshot'),
    ('inbound_call_sessions', 'organization_id'),
    ('inbound_call_sessions', 'contact_id'),
    ('inbound_call_sessions', 'phone_id'),
    ('inbound_call_sessions', 'status'),
    ('inbound_call_sessions', 'browser_result'),
    ('inbound_call_sessions', 'voicemail_requested_at'),
    ('inbound_call_sessions', 'created_at'),
    ('inbound_call_sessions', 'ringing_at'),
    ('inbound_call_sessions', 'answered_at'),
    ('inbound_call_sessions', 'ended_at'),
    ('inbound_call_sessions', 'updated_at'),
    ('inbound_call_sessions', 'error_code'),
    ('inbound_call_sessions', 'error_summary'),
    ('incoming_call_availability_leases', 'id'),
    ('incoming_call_availability_leases', 'owner_id'),
    ('incoming_call_availability_leases', 'client_identity'),
    ('incoming_call_availability_leases', 'lease_token_hash'),
    ('incoming_call_availability_leases', 'browser_session_id'),
    ('incoming_call_availability_leases', 'expires_at'),
    ('incoming_call_availability_leases', 'heartbeat_at'),
    ('incoming_call_availability_leases', 'active_inbound_session_id'),
    ('incoming_call_availability_leases', 'created_at'),
    ('incoming_call_availability_leases', 'updated_at'),
    ('inbound_voicemails', 'id'),
    ('inbound_voicemails', 'inbound_session_id'),
    ('inbound_voicemails', 'recording_sid'),
    ('inbound_voicemails', 'status'),
    ('inbound_voicemails', 'duration_seconds'),
    ('inbound_voicemails', 'content_type'),
    ('inbound_voicemails', 'retention_deadline'),
    ('inbound_voicemails', 'handled_at'),
    ('inbound_voicemails', 'handled_by'),
    ('inbound_voicemails', 'organization_id'),
    ('inbound_voicemails', 'contact_id'),
    ('inbound_voicemails', 'phone_id'),
    ('inbound_voicemails', 'deletion_attempted_at'),
    ('inbound_voicemails', 'deletion_lease_expires_at'),
    ('inbound_voicemails', 'deletion_attempts'),
    ('inbound_voicemails', 'deletion_error'),
    ('inbound_voicemails', 'call_session_id'),
    ('inbound_voicemails', 'created_at'),
    ('inbound_voicemails', 'updated_at'),
    ('call_sessions', 'inbound_technical_session_id')
    ) expected(table_name, column_name)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = current_schema()
      AND actual.table_name = expected.table_name
      AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass(current_schema() || '.call_sessions_inbound_technical_session_unique')
      AND indrelid = to_regclass(current_schema() || '.call_sessions')
      AND indisvalid AND indisunique
  ) AS ready`;

export async function isInboundCallingSchemaReady(client: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<boolean> {
  return (
    (await client.query(inboundCallingSchemaReadySql)).rows[0]?.ready === true
  );
}
