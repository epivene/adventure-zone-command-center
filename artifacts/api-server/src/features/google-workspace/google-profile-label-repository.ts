import { pool as defaultPool } from "@workspace/db";

export type GoogleProfileLabelMapping = {
  connectionId: string;
  organizationId: string;
  gmailLabelId: string;
  gmailLabelName: string;
  state: "active" | "conflict" | "unavailable";
  lastErrorCode: string | null;
};

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function mapping(row: Record<string, unknown> | undefined): GoogleProfileLabelMapping | null {
  if (
    !row ||
    typeof row.connection_id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.gmail_label_id !== "string" ||
    typeof row.gmail_label_name !== "string" ||
    (row.state !== "active" && row.state !== "conflict" && row.state !== "unavailable")
  ) return null;
  return {
    connectionId: row.connection_id,
    organizationId: row.organization_id,
    gmailLabelId: row.gmail_label_id,
    gmailLabelName: row.gmail_label_name,
    state: row.state,
    lastErrorCode:
      typeof row.last_error_code === "string" ? row.last_error_code : null,
  };
}

export type GoogleProfileLabelRepositoryPort = {
  getOrganization(input: { connectionId: string; organizationId: string }):
    Promise<{ id: string; name: string; consolidatedIntoId: string | null } | null>;
  findByOrganization(input: { connectionId: string; organizationId: string }):
    Promise<GoogleProfileLabelMapping | null>;
  findByLabelId(input: { connectionId: string; gmailLabelId: string }):
    Promise<GoogleProfileLabelMapping | null>;
  adopt(input: {
    connectionId: string;
    organizationId: string;
    gmailLabelId: string;
    gmailLabelName: string;
  }): Promise<GoogleProfileLabelMapping>;
  markState(input: {
    connectionId: string;
    organizationId: string;
    state: "conflict" | "unavailable";
    errorCode: string;
  }): Promise<void>;
  listManagedLabelIds(connectionId: string): Promise<string[]>;
};

export class PostgresGoogleProfileLabelRepository
implements GoogleProfileLabelRepositoryPort {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  async getOrganization(input: { connectionId: string; organizationId: string }) {
    const result = await this.pool.query(
      `SELECT o.id::text, o.name, o.consolidated_into_id::text
         FROM organizations o
         INNER JOIN google_workspace_connections c ON c.id = $1
        WHERE o.id = $2
        LIMIT 1`,
      [input.connectionId, input.organizationId],
    );
    const row = result.rows[0];
    if (!row || typeof row.id !== "string" || typeof row.name !== "string") {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      consolidatedIntoId:
        typeof row.consolidated_into_id === "string"
          ? row.consolidated_into_id
          : null,
    };
  }

  async findByOrganization(input: {
    connectionId: string;
    organizationId: string;
  }): Promise<GoogleProfileLabelMapping | null> {
    const result = await this.pool.query(
      `SELECT connection_id::text, organization_id::text, gmail_label_id,
              gmail_label_name, state, last_error_code
         FROM google_workspace_profile_labels
        WHERE connection_id = $1 AND organization_id = $2
        LIMIT 1`,
      [input.connectionId, input.organizationId],
    );
    return mapping(result.rows[0]);
  }

  async findByLabelId(input: {
    connectionId: string;
    gmailLabelId: string;
  }): Promise<GoogleProfileLabelMapping | null> {
    const result = await this.pool.query(
      `SELECT connection_id::text, organization_id::text, gmail_label_id,
              gmail_label_name, state, last_error_code
         FROM google_workspace_profile_labels
        WHERE connection_id = $1 AND gmail_label_id = $2
        LIMIT 1`,
      [input.connectionId, input.gmailLabelId],
    );
    return mapping(result.rows[0]);
  }

  async adopt(input: {
    connectionId: string;
    organizationId: string;
    gmailLabelId: string;
    gmailLabelName: string;
  }): Promise<GoogleProfileLabelMapping> {
    if (
      !input.connectionId.trim() ||
      !input.organizationId.trim() ||
      !input.gmailLabelId.trim() ||
      !input.gmailLabelName.trim()
    ) throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_MAPPING_INVALID");

    try {
      await this.pool.query(
        `INSERT INTO google_workspace_profile_labels (
           connection_id, organization_id, gmail_label_id, gmail_label_name,
           state, last_error_code, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'active',NULL,now(),now())
         ON CONFLICT (connection_id, organization_id) DO UPDATE SET
           gmail_label_id = EXCLUDED.gmail_label_id,
           gmail_label_name = EXCLUDED.gmail_label_name,
           state = 'active',
           last_error_code = NULL,
           updated_at = now()
         WHERE google_workspace_profile_labels.gmail_label_id =
                 EXCLUDED.gmail_label_id
            OR (
              google_workspace_profile_labels.state = 'unavailable'
              AND google_workspace_profile_labels.last_error_code =
                'GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND'
            )`,
        [
          input.connectionId,
          input.organizationId,
          input.gmailLabelId,
          input.gmailLabelName,
        ],
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "23505"
      ) {
        throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT");
      }
      throw error;
    }
    const winner = await this.findByOrganization(input);
    if (!winner) throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_MAPPING_FAILED");
    if (winner.gmailLabelId !== input.gmailLabelId) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT");
    }
    return winner;
  }

  async markState(input: {
    connectionId: string;
    organizationId: string;
    state: "conflict" | "unavailable";
    errorCode: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE google_workspace_profile_labels
          SET state = $3, last_error_code = $4, updated_at = now()
        WHERE connection_id = $1 AND organization_id = $2`,
      [
        input.connectionId,
        input.organizationId,
        input.state,
        input.errorCode,
      ],
    );
  }

  async listManagedLabelIds(connectionId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT gmail_label_id
         FROM google_workspace_profile_labels
        WHERE connection_id = $1 AND state = 'active'
        ORDER BY gmail_label_id`,
      [connectionId],
    );
    return result.rows.flatMap((row) =>
      typeof row.gmail_label_id === "string" && row.gmail_label_id.trim()
        ? [row.gmail_label_id.trim()]
        : [],
    );
  }
}
