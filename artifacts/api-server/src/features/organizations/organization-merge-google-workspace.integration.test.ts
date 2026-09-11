/**
 * PostgreSQL-only regression coverage for organization merges that have
 * Google Workspace rows protected by ON DELETE RESTRICT foreign keys.
 *
 * Run with TEST_DATABASE_URL pointing at a disposable migrated database:
 *   TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-merge-google-workspace.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { DrizzleOrganizationRepository } from "./organization-repository";

const postgresOnly = process.env.TEST_DATABASE_URL ? describe : describe.skip;

postgresOnly("organization merge Google Workspace references", () => {
  it("reparents restrictive Google Workspace organization references before deleting the duplicate", async () => {
    const primaryId = randomUUID();
    const duplicateId = randomUUID();
    const connectionId = randomUUID();
    const mappingId = randomUUID();
    const reviewItemId = randomUUID();
    const profileFileId = randomUUID();
    const editionId = randomUUID();
    const memberId = randomUUID();
    const accountEmail = `merge-google-${connectionId}@example.com`;
    const messageId = `merge-google-message-${mappingId}`;
    const reviewMessageId = `merge-google-review-${reviewItemId}`;
    const fileMessageId = `merge-google-file-${profileFileId}`;

    try {
      await db.execute(sql`
        INSERT INTO organizations (id, name, place_type)
        VALUES
          (${primaryId}, ${`Google Merge Survivor ${primaryId}`}, 'other'),
          (${duplicateId}, ${`Google Merge Duplicate ${duplicateId}`}, 'other')
      `);

      await db.execute(sql`
        INSERT INTO google_workspace_connections
          (id, account_email, role, status, encrypted_refresh_token)
        VALUES
          (${connectionId}, ${accountEmail}, 'workspace', 'disconnected', '{}'::jsonb)
      `);

      await db.execute(sql`
        INSERT INTO google_workspace_validation_mappings
          (id, connection_id, message_id, thread_id, organization_id)
        VALUES
          (${mappingId}, ${connectionId}, ${messageId}, ${`thread-${mappingId}`}, ${duplicateId})
      `);

      await db.execute(sql`
        INSERT INTO google_workspace_validation_review_items
          (id, connection_id, message_id, thread_id, review_state, resolved_organization_id)
        VALUES
          (${reviewItemId}, ${connectionId}, ${reviewMessageId}, ${`thread-${reviewItemId}`}, 'resolved', ${duplicateId})
      `);

      await db.execute(sql`
        INSERT INTO google_workspace_profile_files
          (id, connection_id, organization_id, thread_id, message_id, attachment_id,
           filename, mime_type, size_bytes)
        VALUES
          (${profileFileId}, ${connectionId}, ${duplicateId}, ${`thread-${profileFileId}`},
           ${fileMessageId}, ${`attachment-${profileFileId}`}, 'merge-test.txt', 'text/plain', 1)
      `);

      await db.execute(sql`
        INSERT INTO convention_editions (id, convention, year)
        VALUES (${editionId}, ${`Merge Test ${editionId}`}, 2099)
      `);

      await db.execute(sql`
        INSERT INTO convention_members
          (id, edition_id, source_key, organization_id, data)
        VALUES
          (${memberId}, ${editionId}, ${`merge-test-${memberId}`}, ${duplicateId}, '{}'::jsonb)
      `);

      const repository = new DrizzleOrganizationRepository(db);
      await repository.mergeOrganizations(primaryId, [duplicateId]);

      const duplicateRows = await db.execute(sql`
        SELECT id FROM organizations WHERE id = ${duplicateId}
      `) as unknown as { rows: Array<{ id: string }> };
      expect(duplicateRows.rows).toHaveLength(0);

      const mappingRows = await db.execute(sql`
        SELECT organization_id AS "organizationId"
        FROM google_workspace_validation_mappings
        WHERE id = ${mappingId}
      `) as unknown as { rows: Array<{ organizationId: string }> };
      expect(mappingRows.rows).toEqual([{ organizationId: primaryId }]);

      const reviewRows = await db.execute(sql`
        SELECT resolved_organization_id AS "organizationId"
        FROM google_workspace_validation_review_items
        WHERE id = ${reviewItemId}
      `) as unknown as { rows: Array<{ organizationId: string }> };
      expect(reviewRows.rows).toEqual([{ organizationId: primaryId }]);

      const fileRows = await db.execute(sql`
        SELECT organization_id AS "organizationId"
        FROM google_workspace_profile_files
        WHERE id = ${profileFileId}
      `) as unknown as { rows: Array<{ organizationId: string }> };
      expect(fileRows.rows).toEqual([{ organizationId: primaryId }]);

      const memberRows = await db.execute(sql`
        SELECT organization_id AS "organizationId"
        FROM convention_members
        WHERE id = ${memberId}
      `) as unknown as { rows: Array<{ organizationId: string }> };
      expect(memberRows.rows).toEqual([{ organizationId: primaryId }]);
    } finally {
      await db.execute(sql`DELETE FROM convention_members WHERE id = ${memberId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM convention_editions WHERE id = ${editionId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM google_workspace_profile_files WHERE id = ${profileFileId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM google_workspace_validation_review_items WHERE id = ${reviewItemId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM google_workspace_validation_mappings WHERE id = ${mappingId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM google_workspace_connections WHERE id = ${connectionId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id IN (${primaryId}, ${duplicateId})`).catch(() => undefined);
    }
  });
});
