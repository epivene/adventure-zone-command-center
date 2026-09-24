import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PostgresBusinessKnowledgeRepository } from "../assistant/business-knowledge-repository";
it("never replaces reviewed legacy rules when startup seeds run", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE package_templates(id uuid,code text);CREATE TABLE resources(id uuid,code text);
 CREATE TABLE business_knowledge_entries(seed_key text UNIQUE,scope text,scope_record_id uuid,title text,body text,source_url text,source_label text,active boolean,created_by text,updated_at timestamptz,last_reviewed_at timestamptz);
 INSERT INTO business_knowledge_entries(seed_key,body,last_reviewed_at) VALUES('global-event-pricing-model','Owner correction',now());`);
    const pool = {
      connect: async () => ({ query: db.query.bind(db), release: () => {} }),
    };
    await new PostgresBusinessKnowledgeRepository(
      pool as any,
    ).upsertInitialSeed("owner");
    expect(
      (
        await db.query<any>(
          `SELECT body FROM business_knowledge_entries WHERE seed_key='global-event-pricing-model'`,
        )
      ).rows[0].body,
    ).toBe("Owner correction");
  } finally {
    await db.close();
  }
});
