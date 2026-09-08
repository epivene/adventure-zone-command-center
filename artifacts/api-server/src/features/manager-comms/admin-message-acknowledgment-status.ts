import { sql } from "drizzle-orm";
import type { db as databaseClient } from "@/db/client";

function rows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? []) as T[];
}

export type AdminMessageAcknowledgmentStatus = {
  id: string;
  legId: string;
  status: "waiting_acknowledgment" | "acknowledged" | "needs_admin_review" | "resolved";
  managerComment: string | null;
  acknowledgedAt: Date | null;
};

export async function listAdminMessageAcknowledgments(
  database: typeof databaseClient,
  messageId: string,
): Promise<AdminMessageAcknowledgmentStatus[]> {
  const result = await database.execute(sql`
    select
      id,
      leg_id as "legId",
      status,
      manager_comment as "managerComment",
      acknowledged_at as "acknowledgedAt"
    from manager_acknowledgments
    where source_type = 'manager_message'
      and source_id = ${messageId}
    order by created_at, leg_id
  `);
  return rows<any>(result).map((row) => ({
    ...row,
    acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt) : null,
  }));
}
