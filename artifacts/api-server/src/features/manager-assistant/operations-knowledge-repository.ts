import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

export type OperationsKnowledgeScope = "global" | "package" | "resource" | "site" | "leg";

export class OperationsKnowledgeRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async create(input: {
    title: string;
    body: string;
    scope: OperationsKnowledgeScope;
    scopeRecordId: string | null;
    sourceAdminQuestionId: string | null;
    effectiveAt: Date;
    reviewAfter: Date | null;
    createdBy: string;
  }) {
    const result = await this.pool.query(
      `INSERT INTO operations_knowledge_entries
         (title, body, scope, scope_record_id, source_admin_question_id,
          effective_at, review_after, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, title, body, scope, scope_record_id, source_admin_question_id,
                 active, effective_at, review_after, created_by, created_at, updated_at`,
      [
        input.title.trim(),
        input.body.trim(),
        input.scope,
        input.scopeRecordId,
        input.sourceAdminQuestionId,
        input.effectiveAt,
        input.reviewAfter,
        input.createdBy,
      ],
    );
    return result.rows[0];
  }

  async deactivate(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE operations_knowledge_entries SET active=false, updated_at=now()
       WHERE id=$1 AND active=true RETURNING id`,
      [id],
    );
    return result.rowCount === 1;
  }
}
