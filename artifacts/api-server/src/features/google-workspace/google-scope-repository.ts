import { pool as defaultPool } from "@workspace/db";

import type {
  GoogleSavedScope,
  GoogleScopePersistence,
  ReplaceGoogleScopeInput,
} from "./google-scope-types";

type ScopeSqlResult = {
  rows: Array<Record<string, unknown>>;
};

type ScopeSqlClient = {
  query(text: string, values?: unknown[]): Promise<ScopeSqlResult>;
  release(): void;
};

type ScopeSqlPool = {
  connect(): Promise<ScopeSqlClient>;
};

function labelRows(rows: Array<Record<string, unknown>>) {
  return rows.flatMap((row) =>
    typeof row.label_id === "string" &&
    typeof row.label_name === "string" &&
    typeof row.root_label_id === "string" &&
    typeof row.root_label_name === "string"
      ? [{
          id: row.label_id,
          name: row.label_name,
          rootId: row.root_label_id,
          rootName: row.root_label_name,
        }]
      : [],
  );
}

function calendarRows(rows: Array<Record<string, unknown>>) {
  return rows.flatMap((row) =>
    typeof row.calendar_id === "string" && typeof row.summary === "string"
      ? [{
          id: row.calendar_id,
          summary: row.summary,
          primary: row.primary_calendar === true,
        }]
      : [],
  );
}

export class PostgresGoogleScopePersistence implements GoogleScopePersistence {
  constructor(
    private readonly pool: ScopeSqlPool = defaultPool as unknown as ScopeSqlPool,
  ) {}

  async get(connectionId: string): Promise<GoogleSavedScope> {
    const client = await this.pool.connect();
    try {
      const labels = await client.query(
        `SELECT label_id, label_name, root_label_id, root_label_name
           FROM google_workspace_label_scopes
          WHERE connection_id = $1
            AND selected = true
          ORDER BY root_label_name, label_name, label_id`,
        [connectionId],
      );
      const calendars = await client.query(
        `SELECT calendar_id, summary, primary_calendar
           FROM google_workspace_calendar_scopes
          WHERE connection_id = $1
            AND selected = true
          ORDER BY summary, calendar_id`,
        [connectionId],
      );
      return {
        labels: labelRows(labels.rows),
        calendars: calendarRows(calendars.rows),
      };
    } finally {
      client.release();
    }
  }

  async replace(input: ReplaceGoogleScopeInput): Promise<void> {
    if (!input.connectionId.trim() || !Number.isFinite(input.now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_SCOPE_INPUT_INVALID");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM google_workspace_label_scopes
          WHERE connection_id = $1`,
        [input.connectionId],
      );
      await client.query(
        `DELETE FROM google_workspace_calendar_scopes
          WHERE connection_id = $1`,
        [input.connectionId],
      );

      for (const label of input.labels) {
        await client.query(
          `INSERT INTO google_workspace_label_scopes (
             connection_id,
             label_id,
             label_name,
             root_label_id,
             root_label_name,
             selected,
             discovered_at,
             updated_at
           ) VALUES ($1, $2, $3, $4, $5, true, $6, $6)`,
          [
            input.connectionId,
            label.id,
            label.name,
            label.rootId,
            label.rootName,
            input.now,
          ],
        );
      }

      for (const calendar of input.calendars) {
        await client.query(
          `INSERT INTO google_workspace_calendar_scopes (
             connection_id,
             calendar_id,
             summary,
             primary_calendar,
             selected,
             discovered_at,
             updated_at
           ) VALUES ($1, $2, $3, $4, true, $5, $5)`,
          [
            input.connectionId,
            calendar.id,
            calendar.summary,
            calendar.primary,
            input.now,
          ],
        );
      }

      await client.query(
        `INSERT INTO google_workspace_audit_events (
           actor_kind,
           actor_id,
           action,
           target_type,
           target_id,
           metadata,
           created_at
         ) VALUES ($1, $2, 'scope_replaced', 'connection', $3, $4, $5)`,
        [
          input.actorKind,
          input.actorId,
          input.connectionId,
          {
            labelIds: input.labels.map((label) => label.id),
            calendarIds: input.calendars.map((calendar) => calendar.id),
          },
          input.now,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
