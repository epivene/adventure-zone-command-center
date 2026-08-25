import { pool as defaultPool } from "@workspace/db";

import type { GoogleValidationRow } from "./google-recent-validation-service";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export type GoogleValidationResultLike = {
  checkedLimit: number;
  aiEnabled: boolean;
  historicalImportStarted: false;
  validationStatus: "not_started" | "ready_for_review" | "approved" | "rejected";
  counts: {
    discovered: number;
    matched: number;
    needsReview: number;
    ignored: number;
  };
  matched: GoogleValidationRow[];
  needsReview: GoogleValidationRow[];
  ignored: GoogleValidationRow[];
};

type Decision = {
  state: "resolved" | "ignored";
  organization: { id: string; name: string } | null;
};

function withEvidence<T extends GoogleValidationRow>(row: T, code: string): T {
  return {
    ...row,
    evidenceCodes: [...new Set([...row.evidenceCodes, code])],
  } as T;
}

export class GoogleValidationManualDecisionOverlay {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  private async connectionId(): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT id FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
        ORDER BY updated_at DESC LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    return typeof id === "string" && id ? id : null;
  }

  async apply<T extends GoogleValidationResultLike>(result: T): Promise<T> {
    const connectionId = await this.connectionId();
    if (!connectionId) return result;

    const rows = [...result.matched, ...result.needsReview, ...result.ignored];
    const messageIds = [...new Set(rows.map((row) => row.id).filter(Boolean))];
    if (!messageIds.length) return result;

    const query = await this.pool.query(
      `SELECT r.message_id,
              r.review_state,
              r.resolved_organization_id,
              o.name AS organization_name
         FROM google_workspace_validation_review_items r
         LEFT JOIN organizations o ON o.id = r.resolved_organization_id
        WHERE r.connection_id = $1
          AND r.message_id = ANY($2::text[])
          AND r.review_state IN ('resolved','ignored')`,
      [connectionId, messageIds],
    );

    const decisions = new Map<string, Decision>();
    for (const entry of query.rows) {
      if (typeof entry.message_id !== "string") continue;
      if (entry.review_state === "ignored") {
        decisions.set(entry.message_id, { state: "ignored", organization: null });
      } else if (
        entry.review_state === "resolved" &&
        typeof entry.resolved_organization_id === "string" &&
        typeof entry.organization_name === "string"
      ) {
        decisions.set(entry.message_id, {
          state: "resolved",
          organization: { id: entry.resolved_organization_id, name: entry.organization_name },
        });
      }
    }
    if (!decisions.size) return result;

    const matched: GoogleValidationRow[] = [];
    const needsReview: GoogleValidationRow[] = [];
    const ignored: GoogleValidationRow[] = [];
    const originalMatched = new Set(result.matched.map((row) => row.id));
    const originalReview = new Set(result.needsReview.map((row) => row.id));

    for (const row of rows) {
      const decision = decisions.get(row.id);
      if (decision?.state === "ignored") {
        ignored.push({
          ...withEvidence(row, "manual_ignore"),
          resolvedOrganization: null,
        });
      } else if (decision?.state === "resolved" && decision.organization) {
        matched.push({
          ...withEvidence(row, "manual_profile_assignment"),
          resolvedOrganization: decision.organization,
        });
      } else if (originalMatched.has(row.id)) {
        matched.push(row);
      } else if (originalReview.has(row.id)) {
        needsReview.push(row);
      } else {
        ignored.push(row);
      }
    }

    return {
      ...result,
      counts: {
        discovered: result.counts.discovered,
        matched: matched.length,
        needsReview: needsReview.length,
        ignored: ignored.length,
      },
      matched,
      needsReview,
      ignored,
    } as T;
  }
}
