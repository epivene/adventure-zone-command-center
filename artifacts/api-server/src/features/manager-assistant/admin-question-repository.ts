import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

export type AdminQuestionCreateInput = {
  clientMutationId: string;
  travelLegId: string;
  bookingId: string | null;
  tripId: string | null;
  managerSessionSubject: string;
  question: string;
  urgency: "normal" | "urgent";
  escalationReason: string;
  checkedSourceRefs: unknown[];
  contextSnapshot: unknown;
};

export type AdminQuestionRecord = AdminQuestionCreateInput & {
  id: string;
  status: "needs_answer" | "answered" | "resolved";
  createdAt?: string;
  answeredAt?: string | null;
  resolvedAt?: string | null;
  updatedAt?: string;
};

export interface AdminQuestionStore {
  findByClientMutationId(id: string): Promise<AdminQuestionRecord | null>;
  insert(input: AdminQuestionCreateInput): Promise<AdminQuestionRecord>;
}

export async function createAdminQuestionRecord(
  store: AdminQuestionStore,
  input: AdminQuestionCreateInput,
): Promise<AdminQuestionRecord & { idempotent: boolean }> {
  const existing = await store.findByClientMutationId(input.clientMutationId);
  if (existing) return { ...existing, idempotent: true };
  const created = await store.insert(input);
  return { ...created, idempotent: false };
}

export class PostgresAdminQuestionRepository implements AdminQuestionStore {
  constructor(private readonly pool: Pool = defaultPool) {}

  async findByClientMutationId(id: string): Promise<AdminQuestionRecord | null> {
    const result = await this.pool.query(
      `SELECT id, client_mutation_id, travel_leg_id, booking_id, trip_id,
              manager_session_subject, question, urgency, status,
              escalation_reason, checked_source_refs, context_snapshot,
              created_at, answered_at, resolved_at, updated_at
       FROM manager_admin_questions
       WHERE client_mutation_id = $1
       LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapQuestion(result.rows[0]) : null;
  }

  async insert(input: AdminQuestionCreateInput): Promise<AdminQuestionRecord> {
    const result = await this.pool.query(
      `INSERT INTO manager_admin_questions
         (client_mutation_id, travel_leg_id, booking_id, trip_id,
          manager_session_subject, question, urgency, escalation_reason,
          checked_source_refs, context_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
       ON CONFLICT (client_mutation_id) DO NOTHING
       RETURNING *`,
      [
        input.clientMutationId,
        input.travelLegId,
        input.bookingId,
        input.tripId,
        input.managerSessionSubject,
        input.question.trim(),
        input.urgency,
        input.escalationReason.trim(),
        JSON.stringify(input.checkedSourceRefs),
        JSON.stringify(input.contextSnapshot),
      ],
    );
    if (result.rows[0]) return mapQuestion(result.rows[0]);
    const existing = await this.findByClientMutationId(input.clientMutationId);
    if (!existing) throw new Error("Admin question could not be saved.");
    return existing;
  }

  async listForLeg(legId: string): Promise<AdminQuestionRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM manager_admin_questions
       WHERE travel_leg_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [legId],
    );
    return result.rows.map(mapQuestion);
  }

  async listOpenForAdmin(): Promise<AdminQuestionRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM manager_admin_questions
       WHERE status IN ('needs_answer','answered')
       ORDER BY CASE WHEN urgency='urgent' THEN 0 ELSE 1 END, created_at ASC, id ASC
       LIMIT 200`,
    );
    return result.rows.map(mapQuestion);
  }

  async addResponse(input: {
    questionId: string;
    actorType: "admin" | "manager";
    actorId: string;
    body: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO manager_admin_question_responses
           (question_id, actor_type, actor_id, body)
         VALUES ($1,$2,$3,$4)
         RETURNING id, question_id, actor_type, actor_id, body, created_at`,
        [input.questionId, input.actorType, input.actorId, input.body.trim()],
      );
      if (input.actorType === "admin") {
        await client.query(
          `UPDATE manager_admin_questions
           SET status='answered', answered_at=COALESCE(answered_at, now()), updated_at=now()
           WHERE id=$1 AND status <> 'resolved'`,
          [input.questionId],
        );
      } else {
        await client.query(
          `UPDATE manager_admin_questions SET updated_at=now() WHERE id=$1`,
          [input.questionId],
        );
      }
      await client.query("COMMIT");
      return inserted.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listResponses(questionId: string) {
    const result = await this.pool.query(
      `SELECT id, question_id, actor_type, actor_id, body, created_at
       FROM manager_admin_question_responses
       WHERE question_id=$1
       ORDER BY created_at, id`,
      [questionId],
    );
    return result.rows;
  }

  async resolve(questionId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE manager_admin_questions
       SET status='resolved', resolved_at=now(), updated_at=now()
       WHERE id=$1 AND status <> 'resolved'
       RETURNING id`,
      [questionId],
    );
    return result.rowCount === 1;
  }
}

function mapQuestion(row: any): AdminQuestionRecord {
  return {
    id: row.id,
    clientMutationId: row.client_mutation_id,
    travelLegId: row.travel_leg_id,
    bookingId: row.booking_id,
    tripId: row.trip_id,
    managerSessionSubject: row.manager_session_subject,
    question: row.question,
    urgency: row.urgency,
    status: row.status,
    escalationReason: row.escalation_reason,
    checkedSourceRefs: row.checked_source_refs ?? [],
    contextSnapshot: row.context_snapshot ?? {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}
