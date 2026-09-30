// Local SQL fixture uses production column names; no application runtime or providers.
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureChatGPTConnectionSchema } from "../../db/chatgpt-connection-schema";
import { connectionScopes, type ConnectionPrincipal } from "./contracts";
export async function fixture() {
  const db = new PGlite();
  await ensureChatGPTConnectionSchema(db);
  await db.exec(fixtureSql);
  const principal: ConnectionPrincipal = {
    ownerId: "owner",
    connectionId: randomUUID(),
    clientId: "client",
    scopes: [...connectionScopes],
  };
  await db.query(
    "INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,$3,$4)",
    [
      principal.connectionId,
      principal.ownerId,
      principal.clientId,
      JSON.stringify(principal.scopes),
    ],
  );
  const profileId = randomUUID();
  await db.query(
    "INSERT INTO organizations(id,name,city,region) VALUES($1,'County Fair','Town','UT')",
    [profileId],
  );
  return { db, principal, profileId };
}

export const fixtureSql = `CREATE TABLE organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,place_type text NOT NULL DEFAULT 'other',phone text,normalized_phone text,address_1 text,address_2 text,city text,region text,postal_code text,website text,consolidated_into_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,first_name text,last_name text,email text,phone text,job_title text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean DEFAULT true,role text,is_primary boolean DEFAULT false);
 CREATE TABLE bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,name text,starts_at timestamptz,ends_at timestamptz,status text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,subject text,body text,occurred_at timestamptz,timeline_sort_at timestamptz NOT NULL,date_is_import_fallback boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),deleted_at timestamptz);
 CREATE TABLE activity_associations(activity_id uuid,organization_id uuid,contact_id uuid,booking_id uuid);
 CREATE TABLE follow_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,due_at timestamptz,completed_at timestamptz,outcome text,next_follow_up_id uuid,organization_location_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE business_documents(id uuid PRIMARY KEY,display_name text,lifecycle text DEFAULT 'active',current_version_id uuid,updated_at timestamptz DEFAULT now());
 CREATE TABLE business_document_versions(id uuid PRIMARY KEY,document_id uuid,blob_id uuid);
 CREATE TABLE business_document_blobs(id uuid PRIMARY KEY,sha256_hex text,validation_state text DEFAULT 'accepted');
 CREATE TABLE business_document_links(document_id uuid,organization_id uuid,booking_id uuid);
 CREATE TABLE google_workspace_profile_email_threads(id uuid,organization_id uuid,connection_id uuid);
 CREATE TABLE google_workspace_profile_email_thread_sources(conversation_id uuid,connection_id uuid,gmail_thread_id text);
 CREATE TABLE assistant_workspace_document_extractions(cache_key text,actor_id text,state text,result jsonb,updated_at timestamptz DEFAULT now());`;
