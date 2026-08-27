import { pool as defaultPool } from "@workspace/db";

import {
  decryptGoogleSecret,
  encryptGoogleSecret,
  type EncryptedGoogleSecretV1,
} from "./encrypted-google-secret";
import { GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE, createGoogleWorkspaceReadClient } from "./google-api-client";
import type { GoogleGmailDraftClient, GoogleWorkspaceReadClient } from "./google-api-types";
import {
  createGoogleGmailDeliveryClient,
  type GoogleGmailDeliveryClient,
} from "./google-gmail-delivery-client";
import {
  getGoogleWorkspaceEnvironment,
  type GoogleWorkspaceEnvironment,
} from "./google-workspace-env";

export type GoogleConnectionView = {
  id: string;
  email: string;
  status: "connected" | "reauthorization_required" | "disconnected";
  grantedScopes: string[];
  connectedAt: string;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
};

type QueryResult = {
  rows: Array<Record<string, unknown>>;
  rowCount?: number | null;
};

export interface GoogleConnectionSqlPool {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

type CreateClient = (input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken?: string;
}) => GoogleWorkspaceReadClient;

type CreateDeliveryClient = (input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken: string;
}) => GoogleGmailDeliveryClient;

type ConnectionRow = {
  id: string;
  account_email: string;
  status: GoogleConnectionView["status"];
  encrypted_refresh_token: EncryptedGoogleSecretV1;
  granted_scopes: unknown;
  google_subject: string | null;
  connected_at: Date | string;
  last_verified_at: Date | string | null;
  disconnected_at: Date | string | null;
  last_error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function dateIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("GOOGLE_WORKSPACE_CONNECTION_DATE_INVALID");
  }
  return date.toISOString();
}

function scopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is string => typeof scope === "string");
}

function asRow(value: Record<string, unknown> | undefined): ConnectionRow | null {
  if (!value) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.account_email !== "string" ||
    (value.status !== "connected" &&
      value.status !== "reauthorization_required" &&
      value.status !== "disconnected") ||
    !value.encrypted_refresh_token ||
    typeof value.encrypted_refresh_token !== "object"
  ) {
    throw new Error("GOOGLE_WORKSPACE_CONNECTION_ROW_INVALID");
  }
  return value as unknown as ConnectionRow;
}

function toView(row: ConnectionRow): GoogleConnectionView {
  const missingCompose = !scopes(row.granted_scopes).includes(GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE);
  return {
    id: row.id,
    email: row.account_email,
    status: row.status === "connected" && missingCompose ? "reauthorization_required" : row.status,
    grantedScopes: scopes(row.granted_scopes),
    connectedAt: dateIso(row.connected_at) as string,
    lastVerifiedAt: dateIso(row.last_verified_at),
    lastErrorCode: missingCompose ? "GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE_REQUIRED" : row.last_error_code,
  };
}

export class PostgresGoogleConnectionRepository {
  private readonly pool: GoogleConnectionSqlPool;
  private readonly providedEnvironment: GoogleWorkspaceEnvironment | undefined;
  private readonly createClient: CreateClient;
  private readonly createDeliveryClient: CreateDeliveryClient;

  constructor(options?: {
    pool?: GoogleConnectionSqlPool;
    environment?: GoogleWorkspaceEnvironment;
    createClient?: CreateClient;
    createDeliveryClient?: CreateDeliveryClient;
  }) {
    this.pool = options?.pool ?? (defaultPool as unknown as GoogleConnectionSqlPool);
    this.providedEnvironment = options?.environment;
    this.createClient = options?.createClient ?? createGoogleWorkspaceReadClient;
    this.createDeliveryClient = options?.createDeliveryClient ?? createGoogleGmailDeliveryClient;
  }

  async upsertConnected(input: {
    accountEmail: string;
    googleSubject: string | null;
    refreshToken: string;
    scopes: string[];
    now: Date;
  }): Promise<GoogleConnectionView> {
    const environment = this.requireEnvironment();
    const email = input.accountEmail.trim().toLowerCase();
    const refreshToken = input.refreshToken.trim();
    const googleSubject = input.googleSubject?.trim() || null;
    if (!email || !refreshToken || !Number.isFinite(input.now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_CONNECTION_INPUT_INVALID");
    }

    const current = await this.currentRow();
    const currentSubject = current?.google_subject?.trim() || null;
    if (
      current &&
      (current.account_email.trim().toLowerCase() !== email ||
        (currentSubject !== null && currentSubject !== googleSubject))
    ) {
      throw new Error("GOOGLE_WORKSPACE_ACCOUNT_CHANGE_REQUIRES_DISCONNECT");
    }

    const grantedScopes = [...new Set(input.scopes.map((scope) => scope.trim()))].filter(Boolean);
    const encryptedRefreshToken = encryptGoogleSecret(refreshToken, environment.tokenEncryptionKey);

    const result = await this.pool.query(
      `WITH upserted AS (
         INSERT INTO google_workspace_connections (
           account_email,
           encrypted_refresh_token,
           granted_scopes,
           google_subject,
           connected_at,
           last_verified_at,
           status,
           disconnected_at,
           last_error_code,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $5, 'connected', NULL, NULL, $5, $5)
         ON CONFLICT (account_email) DO UPDATE SET
           encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
           granted_scopes = EXCLUDED.granted_scopes,
           google_subject = EXCLUDED.google_subject,
           connected_at = EXCLUDED.connected_at,
           last_verified_at = EXCLUDED.last_verified_at,
           status = 'connected',
           disconnected_at = NULL,
           last_error_code = NULL,
           updated_at = EXCLUDED.updated_at
         RETURNING *
       ), audited AS (
         INSERT INTO google_workspace_audit_events (
           actor_kind,
           action,
           target_type,
           target_id,
           metadata,
           created_at
         )
         SELECT
           'system',
           'connection_connected',
           'connection',
           id::text,
           jsonb_build_object('accountEmail', account_email),
           $5
         FROM upserted
       )
       SELECT * FROM upserted`,
      [email, encryptedRefreshToken, JSON.stringify(grantedScopes), googleSubject, input.now],
    );
    const row = asRow(result.rows[0]);
    if (!row) throw new Error("GOOGLE_WORKSPACE_CONNECTION_SAVE_FAILED");
    return toView(row);
  }

  async getCurrent(): Promise<GoogleConnectionView | null> {
    const row = await this.currentRow();
    return row ? toView(row) : null;
  }

  async createReadClient(): Promise<GoogleWorkspaceReadClient | null> {
    const row = await this.currentRow();
    if (!row) return null;
    if (row.status === "reauthorization_required") {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(row.encrypted_refresh_token, environment.tokenEncryptionKey);
    return this.createClient({ environment, refreshToken });
  }

  async createGmailDraftClient(): Promise<{ connectionId: string; client: GoogleGmailDraftClient } | null> {
    const row = await this.currentRow();
    if (!row) return null;
    if (row.status === "reauthorization_required" || !scopes(row.granted_scopes).includes(GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE)) {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(row.encrypted_refresh_token, environment.tokenEncryptionKey);
    const client = this.createClient({ environment, refreshToken });
    if (!client.createGmailDraft) throw new Error("GOOGLE_WORKSPACE_GMAIL_DRAFT_CLIENT_UNAVAILABLE");
    return { connectionId: row.id, client: { createGmailDraft: client.createGmailDraft.bind(client) } };
  }

  async createGmailDeliveryClient(): Promise<{ connectionId: string; client: GoogleGmailDeliveryClient } | null> {
    const row = await this.currentRow();
    if (!row) return null;
    if (row.status === "reauthorization_required" || !scopes(row.granted_scopes).includes(GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE)) {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(row.encrypted_refresh_token, environment.tokenEncryptionKey);
    return {
      connectionId: row.id,
      client: this.createDeliveryClient({ environment, refreshToken }),
    };
  }

  async markReauthorizationRequired(errorCode: string): Promise<void> {
    await this.pool.query(
      `WITH changed AS (
         UPDATE google_workspace_connections
            SET status = 'reauthorization_required',
                last_error_code = $1,
                updated_at = now()
          WHERE status <> 'disconnected'
          RETURNING id
       )
       INSERT INTO google_workspace_audit_events (
         actor_kind,
         action,
         target_type,
         target_id,
         metadata
       )
       SELECT
         'system',
         'connection_reauthorization_required',
         'connection',
         id::text,
         jsonb_build_object('errorCode', $1::text)
       FROM changed`,
      [errorCode.trim() || "invalid_grant"],
    );
  }

  async disconnect(now: Date): Promise<void> {
    if (!Number.isFinite(now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_CONNECTION_DATE_INVALID");
    }
    await this.pool.query(
      `WITH changed AS (
         UPDATE google_workspace_connections
            SET status = 'disconnected',
                disconnected_at = $1,
                updated_at = $1
          WHERE status <> 'disconnected'
          RETURNING id
       )
       INSERT INTO google_workspace_audit_events (
         actor_kind,
         action,
         target_type,
         target_id,
         metadata,
         created_at
       )
       SELECT
         'system',
         'connection_disconnected',
         'connection',
         id::text,
         '{}'::jsonb,
         $1
       FROM changed`,
      [now],
    );
  }

  private requireEnvironment(): GoogleWorkspaceEnvironment {
    if (this.providedEnvironment) return this.providedEnvironment;
    const result = getGoogleWorkspaceEnvironment();
    if (!result.configured) {
      throw new Error("GOOGLE_WORKSPACE_NOT_CONFIGURED");
    }
    return result.value;
  }

  private async currentRow(): Promise<ConnectionRow | null> {
    const result = await this.pool.query(
      `SELECT *
         FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
    );
    return asRow(result.rows[0]);
  }
}
