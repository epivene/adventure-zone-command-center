import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { PostgresGoogleProfileLabelRepository } from "./google-profile-label-repository";

const connectionId = "20000000-0000-4000-8000-000000000001";
const organizationId = "10000000-0000-4000-8000-000000000001";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE google_workspace_profile_labels (
      connection_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      gmail_label_id text NOT NULL,
      gmail_label_name text NOT NULL,
      state text NOT NULL DEFAULT 'active',
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (connection_id, organization_id),
      UNIQUE (connection_id, gmail_label_id)
    );
  `);
  const pool = {
    async query(text: string, values?: unknown[]) {
      const result = values === undefined
        ? await db.query(text)
        : await db.query(text, values as never[]);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
  };
  return {
    db,
    repository: new PostgresGoogleProfileLabelRepository(pool),
  };
}

describe("PostgresGoogleProfileLabelRepository missing-label recovery", () => {
  it("atomically replaces an unavailable Gmail label that no longer exists", async () => {
    const { db, repository } = await fixture();
    try {
      await db.query(
        `INSERT INTO google_workspace_profile_labels (
           connection_id, organization_id, gmail_label_id, gmail_label_name,
           state, last_error_code
         ) VALUES ($1,$2,'Label_missing','Z - AdventureZone/Profiles/Elko County Fair',
                   'unavailable','GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND')`,
        [connectionId, organizationId],
      );

      await expect(repository.adopt({
        connectionId,
        organizationId,
        gmailLabelId: "Label_recreated",
        gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
      })).resolves.toMatchObject({
        gmailLabelId: "Label_recreated",
        state: "active",
        lastErrorCode: null,
      });
    } finally {
      await db.close();
    }
  });

  it("still rejects replacing a live mapping with a different Gmail label", async () => {
    const { db, repository } = await fixture();
    try {
      await db.query(
        `INSERT INTO google_workspace_profile_labels (
           connection_id, organization_id, gmail_label_id, gmail_label_name,
           state
         ) VALUES ($1,$2,'Label_live','Z - AdventureZone/Profiles/Elko County Fair',
                   'active')`,
        [connectionId, organizationId],
      );

      await expect(repository.adopt({
        connectionId,
        organizationId,
        gmailLabelId: "Label_other",
        gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
      })).rejects.toThrow("GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT");
    } finally {
      await db.close();
    }
  });
});
