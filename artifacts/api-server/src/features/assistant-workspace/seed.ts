import type { Pool } from "pg";
import manifest from "../../../../../imports/assistant-knowledge/2026-09-24-approved-rules.json" with { type: "json" };
import { KnowledgeRepository } from "./knowledge";
export async function installApprovedWorkspaceRules(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('assistant-workspace-rules',0))`,
    );
    const rules = new KnowledgeRepository(client);
    for (const rule of manifest.rules) {
      const exists = await client.query(
        `SELECT id FROM assistant_workspace_rules WHERE rule_key=$1 LIMIT 1`,
        [rule.ruleKey],
      );
      if (exists.rows.length) continue;
      const proposal = await rules.propose("owner", rule);
      await rules.approve("owner", proposal.id, 0);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
