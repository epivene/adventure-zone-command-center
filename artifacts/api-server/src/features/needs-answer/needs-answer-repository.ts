import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

import type {
  CreateNeedsAnswerInput,
  NeedsAnswerItem,
  NeedsAnswerStatus,
} from "./needs-answer-types";

function rowToItem(row: any): NeedsAnswerItem {
  return {
    id: String(row.id),
    question: String(row.question),
    organizationId: row.organizationId ?? null,
    contactId: row.contactId ?? null,
    bookingId: row.bookingId ?? null,
    followUpId: row.followUpId ?? null,
    callSessionId: row.callSessionId ?? null,
    userNote: row.userNote ?? null,
    status: row.status as NeedsAnswerStatus,
    resolution: row.resolution ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null,
  };
}

export class NeedsAnswerRepository {
  async ensureSchema(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS guided_call_needs_answers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        question text NOT NULL,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
        follow_up_id uuid REFERENCES follow_ups(id) ON DELETE SET NULL,
        call_session_id uuid REFERENCES call_sessions(id) ON DELETE SET NULL,
        user_note text,
        status text NOT NULL DEFAULT 'open',
        resolution text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        CONSTRAINT guided_call_needs_answers_question_nonblank CHECK (btrim(question) <> ''),
        CONSTRAINT guided_call_needs_answers_status_valid CHECK (status IN ('open', 'resolved')),
        CONSTRAINT guided_call_needs_answers_resolution_consistent CHECK (
          (status = 'open' AND resolved_at IS NULL)
          OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolution IS NOT NULL AND btrim(resolution) <> '')
        )
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS guided_call_needs_answers_status_created_idx
      ON guided_call_needs_answers(status, created_at DESC)
    `);
  }

  async create(input: CreateNeedsAnswerInput): Promise<NeedsAnswerItem> {
    await this.ensureSchema();
    const result = await db.execute(sql`
      INSERT INTO guided_call_needs_answers (
        question, organization_id, contact_id, booking_id, follow_up_id,
        call_session_id, user_note
      ) VALUES (
        ${input.question.trim()},
        ${input.organizationId ?? null}::uuid,
        ${input.contactId ?? null}::uuid,
        ${input.bookingId ?? null}::uuid,
        ${input.followUpId ?? null}::uuid,
        ${input.callSessionId ?? null}::uuid,
        ${input.userNote?.trim() || null}
      )
      RETURNING
        id, question,
        organization_id AS "organizationId",
        contact_id AS "contactId",
        booking_id AS "bookingId",
        follow_up_id AS "followUpId",
        call_session_id AS "callSessionId",
        user_note AS "userNote",
        status, resolution,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        resolved_at AS "resolvedAt"
    `);
    return rowToItem((result as any).rows[0]);
  }

  async list(status?: NeedsAnswerStatus): Promise<NeedsAnswerItem[]> {
    await this.ensureSchema();
    const result = status
      ? await db.execute(sql`
          SELECT
            id, question,
            organization_id AS "organizationId",
            contact_id AS "contactId",
            booking_id AS "bookingId",
            follow_up_id AS "followUpId",
            call_session_id AS "callSessionId",
            user_note AS "userNote",
            status, resolution,
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            resolved_at AS "resolvedAt"
          FROM guided_call_needs_answers
          WHERE status = ${status}
          ORDER BY created_at DESC, id DESC
        `)
      : await db.execute(sql`
          SELECT
            id, question,
            organization_id AS "organizationId",
            contact_id AS "contactId",
            booking_id AS "bookingId",
            follow_up_id AS "followUpId",
            call_session_id AS "callSessionId",
            user_note AS "userNote",
            status, resolution,
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            resolved_at AS "resolvedAt"
          FROM guided_call_needs_answers
          ORDER BY (status = 'open') DESC, created_at DESC, id DESC
        `);
    return ((result as any).rows ?? []).map(rowToItem);
  }

  async resolve(id: string, resolution: string): Promise<NeedsAnswerItem | null> {
    await this.ensureSchema();
    const result = await db.execute(sql`
      UPDATE guided_call_needs_answers
      SET
        status = 'resolved',
        resolution = ${resolution.trim()},
        resolved_at = now(),
        updated_at = now()
      WHERE id = ${id}::uuid
        AND status = 'open'
      RETURNING
        id, question,
        organization_id AS "organizationId",
        contact_id AS "contactId",
        booking_id AS "bookingId",
        follow_up_id AS "followUpId",
        call_session_id AS "callSessionId",
        user_note AS "userNote",
        status, resolution,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        resolved_at AS "resolvedAt"
    `);
    const row = (result as any).rows?.[0];
    return row ? rowToItem(row) : null;
  }
}
