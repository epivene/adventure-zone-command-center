/**
 * PostgreSQL-only regression coverage for directory-import audit rows protected
 * by an ON DELETE RESTRICT organization foreign key.
 *
 * Run with TEST_DATABASE_URL pointing at a disposable migrated database:
 *   TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-merge-directory-import.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { DrizzleOrganizationRepository } from "./organization-repository";

const postgresOnly = process.env.TEST_DATABASE_URL ? describe : describe.skip;

postgresOnly("organization merge directory import references", () => {
  it("reparents directory import audit rows before deleting the duplicate", async () => {
    const primaryId = randomUUID();
    const duplicateId = randomUUID();
    const batch = `merge-directory-${randomUUID()}`;
    const sourceKey = `source-${randomUUID()}`;

    try {
      await db.execute(sql`
        INSERT INTO organizations (id, name, place_type)
        VALUES
          (${primaryId}, ${`Directory Merge Survivor ${primaryId}`}, 'other'),
          (${duplicateId}, ${`Directory Merge Duplicate ${duplicateId}`}, 'other')
      `);

      await db.execute(sql`
        INSERT INTO directory_import_records
          (batch, source_key, payload, organization_id, status)
        VALUES
          (${batch}, ${sourceKey}, '{}'::jsonb, ${duplicateId}, 'created')
      `);

      const repository = new DrizzleOrganizationRepository(db);
      await repository.mergeOrganizations(primaryId, [duplicateId]);

      const duplicateRows = await db.execute(sql`
        SELECT id FROM organizations WHERE id = ${duplicateId}
      `) as unknown as { rows: Array<{ id: string }> };
      expect(duplicateRows.rows).toHaveLength(0);

      const importRows = await db.execute(sql`
        SELECT organization_id AS "organizationId"
        FROM directory_import_records
        WHERE batch = ${batch} AND source_key = ${sourceKey}
      `) as unknown as { rows: Array<{ organizationId: string }> };
      expect(importRows.rows).toEqual([{ organizationId: primaryId }]);
    } finally {
      await db.execute(sql`
        DELETE FROM directory_import_records
        WHERE batch = ${batch} AND source_key = ${sourceKey}
      `).catch(() => undefined);
      await db.execute(sql`
        DELETE FROM organizations WHERE id IN (${primaryId}, ${duplicateId})
      `).catch(() => undefined);
    }
  });
});
