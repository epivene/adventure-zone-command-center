import type { Pool } from "pg";
import type { WorkflowDatabase } from "./workflow-types";

export function workflowDatabase(pool: Pool): WorkflowDatabase {
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
