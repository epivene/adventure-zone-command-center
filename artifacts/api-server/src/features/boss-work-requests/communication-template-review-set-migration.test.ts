import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../../../../lib/db/migrations/20260910_communication_template_review_sets.sql",
  import.meta.url,
);
const sql = existsSync(migration) ? readFileSync(migration, "utf8") : "SELECT 1";

describe("communication template review-set migration", () => {
  it("backfills legacy rows and permits ordered reviews in one request", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE communication_templates (id uuid PRIMARY KEY, name text NOT NULL);
        CREATE TABLE communication_template_reviews (
          id uuid PRIMARY KEY,
          request_id uuid NOT NULL,
          template_id uuid NOT NULL REFERENCES communication_templates(id),
          template_version text,
          content_fingerprint text NOT NULL,
          subject_snapshot text,
          body_snapshot text NOT NULL,
          body_format_snapshot text NOT NULL,
          decision text DEFAULT 'pending' NOT NULL,
          note text,
          decided_by_boss_account_id uuid,
          decided_at timestamptz,
          created_at timestamptz DEFAULT now() NOT NULL,
          updated_at timestamptz DEFAULT now() NOT NULL
        );
        CREATE UNIQUE INDEX communication_template_reviews_request_unique
          ON communication_template_reviews(request_id);
        INSERT INTO communication_templates(id, name) VALUES
          ('11111111-1111-4111-8111-111111111111', 'Template one'),
          ('22222222-2222-4222-8222-222222222222', 'Template two');
        INSERT INTO communication_template_reviews(
          id, request_id, template_id, content_fingerprint, body_snapshot, body_format_snapshot
        ) VALUES (
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444',
          '11111111-1111-4111-8111-111111111111',
          'fingerprint-one', '<p>One</p>', 'html'
        );
      `);

      await db.exec(sql);

      const legacy = (await db.query(
        "SELECT position, template_name_snapshot, verified_links FROM communication_template_reviews",
      )).rows[0];
      expect(legacy).toEqual({
        position: 0,
        template_name_snapshot: "Template one",
        verified_links: [],
      });

      await db.exec(`
        INSERT INTO communication_template_reviews(
          id, request_id, template_id, position, template_name_snapshot,
          content_fingerprint, body_snapshot, body_format_snapshot
        ) VALUES (
          '55555555-5555-4555-8555-555555555555',
          '44444444-4444-4444-8444-444444444444',
          '22222222-2222-4222-8222-222222222222',
          1, 'Template two', 'fingerprint-two', '<p>Two</p>', 'html'
        );
      `);
      expect((await db.query("SELECT id FROM communication_template_reviews")).rows).toHaveLength(2);
      await expect(db.exec(`
        INSERT INTO communication_template_reviews(
          id, request_id, template_id, position, template_name_snapshot,
          content_fingerprint, body_snapshot, body_format_snapshot
        ) VALUES (
          '66666666-6666-4666-8666-666666666666',
          '44444444-4444-4444-8444-444444444444',
          '22222222-2222-4222-8222-222222222222',
          2, 'Duplicate', 'duplicate', '<p>Duplicate</p>', 'html'
        );
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
