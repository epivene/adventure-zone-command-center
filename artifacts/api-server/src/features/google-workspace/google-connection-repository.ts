import { pool as defaultPool } from "@workspace/db";

import {
  decryptGoogleSecret,
  encryptGoogleSecret,
  type EncryptedGoogleSecretV1,
} from "./encrypted-google-secret";
import {
  GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE,
  GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE,
  GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE,
  createGoogleWorkspaceReadClient,
} from "./google-api-client";
import type {
  GoogleDriveBackupClient,
  GoogleGmailDraftClient,
  GoogleGmailLabelMutationClient,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import {
  createGoogleGmailDeliveryClient,
  type GoogleGmailDeliveryClient,
} from "./google-gmail-delivery-client";
import {
  getGoogleWorkspaceEnvironment,
  type GoogleWorkspaceEnvironment,
} from "./google-workspace-env";
import {
  createOperationalCalendarClient as createCalendarClient,
  type OperationalCalendarClient,
} from "./calendar/operational-calendar-client";
import { GOOGLE_OPERATIONAL_CALENDAR_SCOPE } from "./calendar/operational-calendar-oauth";

export type GoogleConnectionRole = "workspace" | "operational_calendar";

export type GoogleConnectionView = {
  id: string;
  email: string;
  status: "connected" | "reauthorization_required" | "disconnected";
  grantedScopes: string[];
  connectedAt: string;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  role?: GoogleConnectionRole;
  operationalCalendarId?: string | null;
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

type CreateOperationalCalendarClient = (input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken: string;
}) => OperationalCalendarClient;

type ConnectionRow = {
  id: string;
  account_email: string;
  role: GoogleConnectionRole;
  operational_calendar_id: string | null;
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

function normalizeRole(value: unknown): GoogleConnectionRole {
  return value === "operational_calendar" ? "operational_calendar" : "workspace";
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
  return {
    ...(value as unknown as ConnectionRow),
    role: normalizeRole(value.role),
    operational_calendar_id:
      typeof value.operational_calendar_id === "string" && value.operational_calendar_id.trim()
        ? value.operational_calendar_id.trim()
        : null,
  };
}

function toView(row: ConnectionRow): GoogleConnectionView {
  const granted = scopes(row.granted_scopes);
  const missingGmailModify = row.role === "workspace" && !granted.includes(GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE);
  const missingDriveFile = row.role === "workspace" && !granted.includes(GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE);
  const missingCalendarWrite = row.role === "operational_calendar" && !granted.includes(GOOGLE_OPERATIONAL_CALENDAR_SCOPE);
  const base: GoogleConnectionView = {
    id: row.id,
    email: row.account_email,
    status: row.status === "connected" && (missingGmailModify || missingDriveFile || missingCalendarWrite) ? "reauthorization_required" : row.status,
    grantedScopes: granted,
    connectedAt: dateIso(row.connected_at) as string,
    lastVerifiedAt: dateIso(row.last_verified_at),
    lastErrorCode: missingGmailModify
      ? "GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE_REQUIRED"
      : missingDriveFile
        ? "GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE_REQUIRED"
        : missingCalendarWrite
        ? "GOOGLE_OPERATIONAL_CALENDAR_WRITE_SCOPE_REQUIRED"
        : row.last_error_code,
  };
  // Preserve the legacy company-connection response shape exactly. The role
  // fields are only exposed for the new operational-calendar connection.
  if (row.role === "operational_calendar") {
    base.role = "operational_calendar";
    base.operationalCalendarId = row.operational_calendar_id;
  }
  return base;
}

export class PostgresGoogleConnectionRepository {
  private readonly pool: GoogleConnectionSqlPool;
  private readonly providedEnvironment: GoogleWorkspaceEnvironment | undefined;
  private readonly createClient: CreateClient;
  private readonly createDeliveryClient: CreateDeliveryClient;
  private readonly createCalendarClient: CreateOperationalCalendarClient;

  constructor(options?: {
    pool?: GoogleConnectionSqlPool;
    environment?: GoogleWorkspaceEnvironment;
    createClient?: CreateClient;
    createDeliveryClient?: CreateDeliveryClient;
    createOperationalCalendarClient?: CreateOperationalCalendarClient;
  }) {
    this.pool = options?.pool ?? (defaultPool as unknown as GoogleConnectionSqlPool);
    this.providedEnvironment = options?.environment;
    this.createClient = options?.createClient ?? createGoogleWorkspaceReadClient;
    this.createDeliveryClient = options?.createDeliveryClient ?? createGoogleGmailDeliveryClient;
    this.createCalendarClient = options?.createOperationalCalendarClient ?? createCalendarClient;
  }

  async upsertConnected(input: {
    accountEmail: string;
    googleSubject: string | null;
    refreshToken: string;
    scopes: string[];
    now: Date;
    role?: GoogleConnectionRole;
    operationalCalendarId?: string | null;
  }): Promise<GoogleConnectionView> {
    const environment = this.requireEnvironment();
    const email = input.accountEmail.trim().toLowerCase();
    const refreshToken = input.refreshToken.trim();
    const googleSubject = input.googleSubject?.trim() || null;
    const connectionRole = normalizeRole(input.role);
    const operationalCalendarId = connectionRole === "operational_calendar"
      ? input.operationalCalendarId?.trim() || email
      : null;
    if (!email || !refreshToken || !Number.isFinite(input.now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_CONNECTION_INPUT_INVALID");
    }

    const current = await this.currentRow(connectionRole);
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

    // Keep the long-standing workspace SQL/value contract intact for existing
    // tests and integrations; the new role-aware shape is isolated to David's
    // operational-calendar connection.
    const result = connectionRole === "workspace"
      ? await this.pool.query(
          `WITH upserted AS (
             INSERT INTO google_workspace_connections (
               account_email, encrypted_refresh_token, granted_scopes, google_subject,
               connected_at, last_verified_at, status, disconnected_at,
               last_error_code, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $5, 'connected', NULL, NULL, $5, $5)
              ON CONFLICT (account_email, role) DO UPDATE SET
               encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
               granted_scopes = EXCLUDED.granted_scopes,
               google_subject = EXCLUDED.google_subject,
               connected_at = EXCLUDED.connected_at,
               last_verified_at = EXCLUDED.last_verified_at,
               status = 'connected', disconnected_at = NULL, last_error_code = NULL,
               role = 'workspace', operational_calendar_id = NULL,
               updated_at = EXCLUDED.updated_at
             RETURNING *
           ), audited AS (
             INSERT INTO google_workspace_audit_events (
               actor_kind, action, target_type, target_id, metadata, created_at
             )
             SELECT 'system', 'connection_connected', 'connection', id::text,
               jsonb_build_object('accountEmail', account_email), $5 FROM upserted
           ) SELECT * FROM upserted`,
          [email, encryptedRefreshToken, JSON.stringify(grantedScopes), googleSubject, input.now],
        )
      : await this.pool.query(
          `WITH upserted AS (
             INSERT INTO google_workspace_connections (
               account_email, role, operational_calendar_id,
               encrypted_refresh_token, granted_scopes, google_subject,
               connected_at, last_verified_at, status, disconnected_at,
               last_error_code, created_at, updated_at
             ) VALUES ($1, 'operational_calendar', $2, $3, $4, $5, $6, $6, 'connected', NULL, NULL, $6, $6)
              ON CONFLICT (account_email, role) DO UPDATE SET
               role = 'operational_calendar', operational_calendar_id = EXCLUDED.operational_calendar_id,
               encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
               granted_scopes = EXCLUDED.granted_scopes, google_subject = EXCLUDED.google_subject,
               connected_at = EXCLUDED.connected_at, last_verified_at = EXCLUDED.last_verified_at,
               status = 'connected', disconnected_at = NULL, last_error_code = NULL,
               updated_at = EXCLUDED.updated_at
             RETURNING *
           ), audited AS (
             INSERT INTO google_workspace_audit_events (
               actor_kind, action, target_type, target_id, metadata, created_at
             )
             SELECT 'system', 'connection_connected', 'connection', id::text,
               jsonb_build_object('accountEmail', account_email, 'role', role), $6 FROM upserted
           ) SELECT * FROM upserted`,
          [email, operationalCalendarId, encryptedRefreshToken, JSON.stringify(grantedScopes), googleSubject, input.now],
        );
    const row = asRow(result.rows[0]);
    if (!row) throw new Error("GOOGLE_WORKSPACE_CONNECTION_SAVE_FAILED");
    return toView(row);
  }

  async getCurrent(): Promise<GoogleConnectionView | null> {
    return this.getByRole("workspace");
  }

  async getByRole(connectionRole: GoogleConnectionRole): Promise<GoogleConnectionView | null> {
    const row = await this.currentRow(connectionRole);
    return row ? toView(row) : null;
  }

  async createReadClient(): Promise<GoogleWorkspaceReadClient | null> {
    return this.createReadClientForRole("workspace");
  }

  async createReadClientForRole(connectionRole: GoogleConnectionRole): Promise<GoogleWorkspaceReadClient | null> {
    const row = await this.currentRow(connectionRole);
    if (!row) return null;
    if (row.status === "reauthorization_required") {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(row.encrypted_refresh_token, environment.tokenEncryptionKey);
    return this.createClient({ environment, refreshToken });
  }

  async createDriveBackupClient(): Promise<{
    connectionId: string;
    client: GoogleDriveBackupClient;
  } | null> {
    const row = await this.currentRow("workspace");
    if (!row) return null;
    if (
      row.status === "reauthorization_required" ||
      !scopes(row.granted_scopes).includes(GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE)
    ) {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(
      row.encrypted_refresh_token,
      environment.tokenEncryptionKey,
    );
    const client = this.createClient({ environment, refreshToken });
    if (!client.driveBackup) {
      throw new Error("GOOGLE_WORKSPACE_DRIVE_BACKUP_CLIENT_UNAVAILABLE");
    }
    return {
      connectionId: row.id,
      client: client.driveBackup,
    };
  }

  async createOperationalCalendarClient(): Promise<{
    connectionId: string;
    calendarId: string;
    client: OperationalCalendarClient;
  } | null> {
    const row = await this.currentRow("operational_calendar");
    if (!row) return null;
    const granted = scopes(row.granted_scopes);
    if (row.status === "reauthorization_required" || !granted.includes(GOOGLE_OPERATIONAL_CALENDAR_SCOPE)) {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const calendarId = row.operational_calendar_id?.trim() || row.account_email.trim();
    if (!calendarId) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_ID_REQUIRED");
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(row.encrypted_refresh_token, environment.tokenEncryptionKey);
    return { connectionId: row.id, calendarId, client: this.createCalendarClient({ environment, refreshToken }) };
  }

  async createGmailDraftClient(): Promise<{ connectionId: string; client: GoogleGmailDraftClient } | null> {
    const row = await this.currentRow("workspace");
    if (!row) return null;
    if (row.status === "reauthorization_required" || !scopes(row.granted_scopes).some((scope) => scope === GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE || scope === GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE)) {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(row.encrypted_refresh_token, environment.tokenEncryptionKey);
    const client = this.createClient({ environment, refreshToken });
    if (!client.createGmailDraft) throw new Error("GOOGLE_WORKSPACE_GMAIL_DRAFT_CLIENT_UNAVAILABLE");
    return { connectionId: row.id, client: { createGmailDraft: client.createGmailDraft.bind(client) } };
  }

  async createGmailLabelMutationClient(): Promise<{ connectionId: string; client: GoogleGmailLabelMutationClient } | null> {
    const row = await this.currentRow("workspace");
    if (!row) return null;
    if (
      row.status === "reauthorization_required" ||
      !scopes(row.granted_scopes).includes(GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE)
    ) {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(
      row.encrypted_refresh_token,
      environment.tokenEncryptionKey,
    );
    const client = this.createClient({ environment, refreshToken });
    if (
      !client.createLabel ||
      !client.renameLabel ||
      !client.getThreadLabelIds ||
      !client.modifyThreadLabels ||
      !client.modifyMessageLabels
    ) {
      throw new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_CLIENT_UNAVAILABLE");
    }
    const guardReauthorization = async <T>(
      operation: () => Promise<T>,
    ): Promise<T> => {
      try {
        return await operation();
      } catch (error) {
        const code =
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : error instanceof Error
              ? error.message
              : "";
        if (code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED") {
          await this.markReauthorizationRequired(code);
        }
        throw error;
      }
    };
    return {
      connectionId: row.id,
      client: {
        listLabels: () => guardReauthorization(() => client.listLabels()),
        getThreadLabelIds: (threadId) =>
          guardReauthorization(() => client.getThreadLabelIds!(threadId)),
        createLabel: (name) =>
          guardReauthorization(() => client.createLabel!(name)),
        renameLabel: (input) =>
          guardReauthorization(() => client.renameLabel!(input)),
        modifyThreadLabels: (input) =>
          guardReauthorization(() => client.modifyThreadLabels!(input)),
        modifyMessageLabels: (input) =>
          guardReauthorization(() => client.modifyMessageLabels!(input)),
      },
    };
  }

  async createGmailDeliveryClient(): Promise<{ connectionId: string; client: GoogleGmailDeliveryClient } | null> {
    const row = await this.currentRow("workspace");
    if (!row) return null;
    if (row.status === "reauthorization_required" || !scopes(row.granted_scopes).some((scope) => scope === GOOGLE_WORKSPACE_GMAIL_COMPOSE_SCOPE || scope === GOOGLE_WORKSPACE_GMAIL_MODIFY_SCOPE)) {
      throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    }
    const environment = this.requireEnvironment();
    const refreshToken = decryptGoogleSecret(row.encrypted_refresh_token, environment.tokenEncryptionKey);
    return { connectionId: row.id, client: this.createDeliveryClient({ environment, refreshToken }) };
  }

  async markReauthorizationRequired(errorCode: string, connectionRole: GoogleConnectionRole = "workspace"): Promise<void> {
    const code = errorCode.trim() || "invalid_grant";
    if (connectionRole === "workspace") {
      await this.pool.query(
        `WITH changed AS (
           UPDATE google_workspace_connections
              SET status = 'reauthorization_required', last_error_code = $1, updated_at = now()
            WHERE status <> 'disconnected' AND (role = 'workspace' OR role IS NULL)
            RETURNING id
         )
         INSERT INTO google_workspace_audit_events (actor_kind, action, target_type, target_id, metadata)
         SELECT 'system', 'connection_reauthorization_required', 'connection', id::text,
           jsonb_build_object('errorCode', $1::text) FROM changed`,
        [code],
      );
      return;
    }
    await this.pool.query(
      `WITH changed AS (
         UPDATE google_workspace_connections
            SET status = 'reauthorization_required', last_error_code = $1, updated_at = now()
          WHERE role = 'operational_calendar' AND status <> 'disconnected'
          RETURNING id
       )
       INSERT INTO google_workspace_audit_events (actor_kind, action, target_type, target_id, metadata)
       SELECT 'system', 'connection_reauthorization_required', 'connection', id::text,
         jsonb_build_object('errorCode', $1::text) FROM changed`,
      [code],
    );
  }

  async disconnect(now: Date, connectionRole: GoogleConnectionRole = "workspace"): Promise<void> {
    if (!Number.isFinite(now.getTime())) throw new Error("GOOGLE_WORKSPACE_CONNECTION_DATE_INVALID");
    const where = connectionRole === "workspace"
      ? "status <> 'disconnected' AND (role = 'workspace' OR role IS NULL)"
      : "status <> 'disconnected' AND role = 'operational_calendar'";
    await this.pool.query(
      `WITH changed AS (
         UPDATE google_workspace_connections
            SET status = 'disconnected', disconnected_at = $1, updated_at = $1
          WHERE ${where}
          RETURNING id
       )
       INSERT INTO google_workspace_audit_events (
         actor_kind, action, target_type, target_id, metadata, created_at
       )
       SELECT 'system', 'connection_disconnected', 'connection', id::text, '{}'::jsonb, $1 FROM changed`,
      [now],
    );
  }

  private requireEnvironment(): GoogleWorkspaceEnvironment {
    if (this.providedEnvironment) return this.providedEnvironment;
    const result = getGoogleWorkspaceEnvironment();
    if (!result.configured) throw new Error("GOOGLE_WORKSPACE_NOT_CONFIGURED");
    return result.value;
  }

  private async currentRow(connectionRole: GoogleConnectionRole): Promise<ConnectionRow | null> {
    const result = connectionRole === "workspace"
      ? await this.pool.query(
          `SELECT * FROM google_workspace_connections
            WHERE status IN ('connected', 'reauthorization_required')
              AND (role = 'workspace' OR role IS NULL)
            ORDER BY updated_at DESC, id DESC LIMIT 1`,
        )
      : await this.pool.query(
          `SELECT * FROM google_workspace_connections
            WHERE role = 'operational_calendar'
              AND status IN ('connected', 'reauthorization_required')
            ORDER BY updated_at DESC, id DESC LIMIT 1`,
        );
    return asRow(result.rows[0]);
  }
}
