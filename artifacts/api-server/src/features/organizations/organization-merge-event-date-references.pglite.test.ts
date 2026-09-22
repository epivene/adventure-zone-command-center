import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reparentEventDateCoverageReferences } from "./organization-merge-additional-references";

const primaryId = "00000000-0000-4000-8000-000000000001";
const duplicateId = "00000000-0000-4000-8000-000000000002";
const runWithConflict = "00000000-0000-4000-8000-000000000010";
const duplicateOnlyRun = "00000000-0000-4000-8000-000000000011";
let client: PGlite;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TABLE event_date_facts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      active boolean NOT NULL,
      status text NOT NULL,
      rationale text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX event_date_facts_one_active_per_org
      ON event_date_facts (organization_id) WHERE active = true;
    CREATE TABLE event_date_coverage_items (
      id uuid PRIMARY KEY,
      run_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      status text NOT NULL,
      attempts integer NOT NULL,
      error_detail text,
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (run_id, organization_id)
    );
  `);
});

afterEach(async () => client.close());

describe("reparentEventDateCoverageReferences", () => {
  it("retains conflicting facts for review and folds duplicate run-item history", async () => {
    await client.query(
      `INSERT INTO event_date_facts (id, organization_id, active, status, rationale) VALUES
       ($1, $2, true, 'confirmed', 'primary source'),
       ($3, $4, true, 'expected', 'duplicate source')`,
      [
        "00000000-0000-4000-8000-000000000020", primaryId,
        "00000000-0000-4000-8000-000000000021", duplicateId,
      ],
    );
    await client.query(
      `INSERT INTO event_date_coverage_items
       (id, run_id, organization_id, status, attempts, error_detail) VALUES
       ($1, $2, $3, 'complete', 1, null),
       ($4, $5, $6, 'failed', 3, 'duplicate failure'),
       ($7, $8, $9, 'needs_review', 2, null)`,
      [
        "00000000-0000-4000-8000-000000000030", runWithConflict, primaryId,
        "00000000-0000-4000-8000-000000000031", runWithConflict, duplicateId,
        "00000000-0000-4000-8000-000000000032", duplicateOnlyRun, duplicateId,
      ],
    );

    const database = drizzle(client);
    await database.transaction(async (transaction) => {
      await reparentEventDateCoverageReferences(
        transaction as never,
        primaryId,
        duplicateId,
        { facts: true, items: true },
      );
    });

    const facts = await client.query<{ organization_id: string; active: boolean; status: string; rationale: string }>(
      "SELECT organization_id, active, status, rationale FROM event_date_facts ORDER BY active DESC",
    );
    expect(facts.rows).toEqual([
      expect.objectContaining({ organization_id: primaryId, active: true, status: "confirmed" }),
      expect.objectContaining({ organization_id: primaryId, active: false, status: "needs_review", rationale: expect.stringContaining("organization merge") }),
    ]);
    const items = await client.query<{ organization_id: string; attempts: number; error_detail: string | null }>(
      "SELECT organization_id, attempts, error_detail FROM event_date_coverage_items ORDER BY run_id",
    );
    expect(items.rows).toHaveLength(2);
    expect(items.rows.every((item) => item.organization_id === primaryId)).toBe(true);
    expect(items.rows[0]).toMatchObject({ attempts: 3, error_detail: expect.stringContaining("duplicate failure") });
  });
});
