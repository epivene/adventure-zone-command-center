import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

type Database = typeof database;

function rowsOf<T>(value: unknown): T[] {
  if (value && typeof value === "object" && "rows" in value) {
    return ((value as { rows?: T[] }).rows ?? []);
  }
  return [];
}

export async function deleteChecklistRun(database: Database, runId: string) {
  const result = await database.execute(sql`
    with removed_conditions as (
      delete from resource_condition_issues
       where checklist_result_id in (
         select id from event_checklist_item_results where run_id=${runId}::uuid
       )
       returning id
    )
    delete from event_checklist_runs
     where id=${runId}::uuid
     returning id
  `);
  return rowsOf<{ id: string }>(result)[0] ?? null;
}