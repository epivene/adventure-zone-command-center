import { createHash } from "node:crypto";
import { pool as defaultPool } from "@workspace/db";

export type GoogleOAuthConnectionRole = "workspace" | "operational_calendar";

export interface GoogleOAuthStateRepository {
  create(input: {
    state: string;
    returnPath: string;
    expiresAt: Date;
    connectionRole?: GoogleOAuthConnectionRole;
  }): Promise<void>;
  consume(input: {
    state: string;
    now: Date;
  }): Promise<{ returnPath: string; connectionRole?: GoogleOAuthConnectionRole } | null>;
  deleteExpired(now: Date): Promise<number>;
}

type QueryResult = {
  rows: Array<Record<string, unknown>>;
  rowCount?: number | null;
};

export interface GoogleOAuthStateSqlPool {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export function hashGoogleOAuthState(state: string): string {
  if (!state.trim()) throw new Error("GOOGLE_WORKSPACE_OAUTH_STATE_INVALID");
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function safeReturnPath(returnPath: string): string {
  const value = returnPath.trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error("GOOGLE_WORKSPACE_OAUTH_RETURN_PATH_INVALID");
  }
  return value;
}

export class PostgresGoogleOAuthStateRepository implements GoogleOAuthStateRepository {
  constructor(
    private readonly pool: GoogleOAuthStateSqlPool = defaultPool as unknown as GoogleOAuthStateSqlPool,
  ) {}

  async create(input: {
    state: string;
    returnPath: string;
    expiresAt: Date;
    connectionRole?: GoogleOAuthConnectionRole;
  }): Promise<void> {
    if (!Number.isFinite(input.expiresAt.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_OAUTH_STATE_EXPIRY_INVALID");
    }
    const values = [
      hashGoogleOAuthState(input.state),
      safeReturnPath(input.returnPath),
      input.expiresAt,
    ];
    if (input.connectionRole === "operational_calendar") {
      await this.pool.query(
        `INSERT INTO google_workspace_oauth_states (
           state_hash, return_path, expires_at, connection_role, created_at
         ) VALUES ($1, $2, $3, 'operational_calendar', now())`,
        values,
      );
      return;
    }
    // Preserve the original three-value workspace insert contract. The schema
    // default supplies connection_role='workspace'.
    await this.pool.query(
      `INSERT INTO google_workspace_oauth_states (
         state_hash, return_path, expires_at, created_at
       ) VALUES ($1, $2, $3, now())`,
      values,
    );
  }

  async consume(input: {
    state: string;
    now: Date;
  }): Promise<{ returnPath: string; connectionRole?: GoogleOAuthConnectionRole } | null> {
    if (!Number.isFinite(input.now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_OAUTH_STATE_TIME_INVALID");
    }
    const result = await this.pool.query(
      `UPDATE google_workspace_oauth_states
          SET consumed_at = $2
        WHERE state_hash = $1
          AND consumed_at IS NULL
          AND expires_at > $2
      RETURNING return_path, connection_role`,
      [hashGoogleOAuthState(input.state), input.now],
    );
    const row = result.rows[0];
    const returnPath = row?.return_path;
    if (typeof returnPath !== "string") return null;
    return row?.connection_role === "operational_calendar"
      ? { returnPath, connectionRole: "operational_calendar" }
      : { returnPath };
  }

  async deleteExpired(now: Date): Promise<number> {
    if (!Number.isFinite(now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_OAUTH_STATE_TIME_INVALID");
    }
    const result = await this.pool.query(
      `WITH deleted AS (
         DELETE FROM google_workspace_oauth_states
          WHERE expires_at <= $1
          RETURNING 1
       )
       SELECT count(*)::int AS deleted_count FROM deleted`,
      [now],
    );
    return Number(result.rows[0]?.deleted_count ?? 0);
  }
}
