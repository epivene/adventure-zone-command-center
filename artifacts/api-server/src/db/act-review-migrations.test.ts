import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";

import { loadActReviewMigrations, runActReviewMigrations } from "@workspace/db/migrations";
import { contactPhones } from "@workspace/db/schema";

describe("runActReviewMigrations", () => {
  it("keeps guarded directory imports pending at startup but retains explicit-run safeguards", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql === "schema-marker") return { rows: [{ ready: queries.includes("schema-repair") }] };
        if (sql === "import-marker") return { rows: [{ ready: false }] };
        if (sql === "guarded-import") throw new Error("Expected the five existing 2026 convention editions");
        return { rows: [] };
      },
      release() {},
    };
    const pool = { connect: async () => client };
    const migrations = [
      { name: "20260910_public_directory_leads.sql", markerSql: "import-marker", sql: "guarded-import" },
      { name: "20260910_rmaf_online_directory.sql", markerSql: "import-marker", sql: "guarded-import" },
      { name: "schema-upgrade.sql", markerSql: "schema-marker", sql: "schema-repair" },
    ];
    expect(await runActReviewMigrations({ pool, migrations, automatic: true })).toEqual(["schema-upgrade.sql"]);
    expect(queries).not.toContain("import-marker");
    expect(queries).not.toContain("guarded-import");
    expect(await runActReviewMigrations({ pool, migrations, automatic: true })).toEqual([]);
    await expect(runActReviewMigrations({ pool, migrations })).rejects.toThrow(
      "Expected the five existing 2026 convention editions",
    );
  });

  it("registers the schema-only directory audit companion before manual imports", async () => {
    const migrations = await loadActReviewMigrations();
    const schemaIndex = migrations.findIndex(({ name }) => name === "20261009_directory_import_audit_schema.sql");
    expect(schemaIndex).toBeGreaterThan(-1);
    expect(schemaIndex).toBeLessThan(migrations.findIndex(({ name }) => name === "20260910_public_directory_leads.sql"));
    expect(migrations[schemaIndex]!.sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\b/im);
  });

  it("loads the approval provenance migration with a two-column marker", async () => {
    const migrations = await loadActReviewMigrations();
    const provenance = migrations.find((migration) => migration.name === "019_act_approval_provenance.sql");

    expect(provenance).toBeDefined();
    expect(provenance?.markerSql).toContain("COUNT(*) = 2");
    expect(provenance?.markerSql).toContain("approval_mode");
    expect(provenance?.markerSql).toContain("approval_mode_version");
  });

  it("keeps call phone snapshots when a referenced phone is replaced", async () => {
    const migrations = await loadActReviewMigrations();
    const metadata = migrations.find((migration) => migration.name === "021_call_session_metadata.sql");
    expect(metadata?.sql).toContain("phone_id uuid REFERENCES contact_phones(id) ON DELETE SET NULL");
  });

  it("registers durable legacy-phone dual-write compatibility for every contact writer", async () => {
    const migrations = await loadActReviewMigrations();
    const compatibility = migrations.find((migration) => migration.name === "022_contact_phone_legacy_compatibility.sql");

    expect(compatibility?.sql).toContain("CREATE TRIGGER contacts_sync_primary_phone");
    expect(compatibility?.sql).toContain("AFTER INSERT OR UPDATE OF phone, normalized_phone ON contacts");
    expect(compatibility?.sql).toContain("do_not_call_at");
  });

  it("registers additive canonical-phone repair and durable destination uniqueness", async () => {
    const migrations = await loadActReviewMigrations();
    const repair = migrations.find((migration) => migration.name === "023_contact_phone_canonical_dnc.sql");

    expect(repair).toBeDefined();
    expect(repair?.markerSql).toContain("contact_phones_contact_normalized_number_unique");
    expect(repair?.sql).toContain("normalize_north_american_phone");
    expect(repair?.sql).toContain("regexp_replace");
    expect(repair?.sql).toContain("[^A-Za-z0-9_]");
    expect(repair?.sql).toContain("do_not_call_at");
    expect(repair?.sql).toContain("do_not_call_reason");
    expect(repair?.sql).toContain("UPDATE call_sessions");
    expect(repair?.sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_contact_normalized_number_unique");
    expect(repair?.sql).toContain("normalized_number = canonical_number");
    expect(repair?.sql).toContain("number = NEW.phone");
  });

  it("declares canonical destinations unique per contact in schema metadata", () => {
    const canonicalIndex = getTableConfig(contactPhones).indexes.find(
      (index) => index.config.name === "contact_phones_contact_normalized_number_unique",
    );

    expect(canonicalIndex?.config.unique).toBe(true);
    expect(canonicalIndex?.config.where).toBeDefined();
  });

  describe("canonical contact-phone migration behavior", () => {
    it("collapses duplicates, preserves DNC, reuses reformatted rows, and blocks recreation", async () => {
      const client = new PGlite();
      const contactId = "11111111-1111-4111-8111-111111111111";
      const primaryPhoneId = "22222222-2222-4222-8222-222222222222";
      const suppressedPhoneId = "33333333-3333-4333-8333-333333333333";
      const clearedContactId = "66666666-6666-4666-8666-666666666666";
      const driftedContactId = "77777777-7777-4777-8777-777777777777";
      try {
        await client.exec(`
          CREATE TABLE contacts (
            id uuid PRIMARY KEY, phone text, normalized_phone text,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE contact_phones (
            id uuid PRIMARY KEY, contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            number text NOT NULL, normalized_number text, type text NOT NULL DEFAULT 'unknown',
            extension text, label text, "primary" boolean NOT NULL DEFAULT false,
            source text NOT NULL DEFAULT 'local', do_not_call_at timestamptz, do_not_call_reason text,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE UNIQUE INDEX contact_phones_one_primary_per_contact
            ON contact_phones(contact_id) WHERE "primary";
          CREATE TABLE call_sessions (id uuid PRIMARY KEY, phone_id uuid REFERENCES contact_phones(id) ON DELETE SET NULL);
          INSERT INTO contacts (id, phone, normalized_phone)
          VALUES ('${contactId}', '(701) 555-0199', NULL);
          INSERT INTO contact_phones (id, contact_id, number, normalized_number, "primary", source)
          VALUES ('${primaryPhoneId}', '${contactId}', '(701) 555-0199', NULL, true, 'legacy');
          INSERT INTO contact_phones (id, contact_id, number, normalized_number, "primary", source, do_not_call_at, do_not_call_reason)
          VALUES ('${suppressedPhoneId}', '${contactId}', '+1 701 555 0199', '+17015550199', false, 'local', '2026-08-01T00:00:00Z', 'Requested');
          INSERT INTO call_sessions (id, phone_id)
          VALUES ('44444444-4444-4444-8444-444444444444', '${suppressedPhoneId}');
          INSERT INTO contacts (id, phone, normalized_phone)
          VALUES ('${clearedContactId}', NULL, NULL),
                 ('${driftedContactId}', '(701) 555-0100', '+17015550100');
          INSERT INTO contact_phones (id, contact_id, number, normalized_number, "primary", source, do_not_call_at, do_not_call_reason)
          VALUES ('88888888-8888-4888-8888-888888888888', '${clearedContactId}', '701-555-0101', '+17015550101', true, 'legacy', '2026-08-02T00:00:00Z', 'Cleared legacy DNC'),
                 ('99999999-9999-4999-8999-999999999999', '${driftedContactId}', '+1 701 555 0100', '+17015550100', true, 'local', '2026-08-03T00:00:00Z', 'Formatting DNC');
        `);
        const migration = (await loadActReviewMigrations()).find(({ name }) => name === "023_contact_phone_canonical_dnc.sql");
        await client.exec(migration!.sql);

        expect((await client.query(`SELECT * FROM contact_phones WHERE contact_id = '${contactId}'`)).rows).toEqual([
          expect.objectContaining<Record<string, unknown>>({
            id: primaryPhoneId,
            normalized_number: "+17015550199",
            primary: true,
            do_not_call_reason: "Requested",
          }),
        ]);
        expect((await client.query(`SELECT phone_id FROM call_sessions`)).rows).toEqual([{ phone_id: primaryPhoneId }]);
        expect((await client.query(`SELECT "primary", do_not_call_reason FROM contact_phones WHERE contact_id = '${clearedContactId}'`)).rows).toEqual([
          { primary: false, do_not_call_reason: "Cleared legacy DNC" },
        ]);
        expect((await client.query(`SELECT number, normalized_number, "primary", do_not_call_reason FROM contact_phones WHERE contact_id = '${driftedContactId}'`)).rows).toEqual([
          { number: "(701) 555-0100", normalized_number: "+17015550100", primary: true, do_not_call_reason: "Formatting DNC" },
        ]);

        await client.query(`UPDATE contacts SET phone = '701.555.0199', normalized_phone = NULL WHERE id = '${contactId}'`);
        expect((await client.query(`SELECT number, normalized_number, do_not_call_reason FROM contact_phones WHERE contact_id = '${contactId}'`)).rows).toEqual([
          { number: "701.555.0199", normalized_number: "+17015550199", do_not_call_reason: "Requested" },
        ]);
        expect((await client.query(`SELECT normalized_phone FROM contacts WHERE id = '${contactId}'`)).rows).toEqual([{ normalized_phone: "+17015550199" }]);
        expect((await client.query(`SELECT count(*)::int AS count FROM contact_phones WHERE normalized_number = '+17015550199'`)).rows).toEqual([{ count: 1 }]);

        await expect(client.query(`
          INSERT INTO contact_phones (id, contact_id, number, normalized_number)
          VALUES ('55555555-5555-4555-8555-555555555555', '${contactId}', '701-555-0199', '+17015550199')
        `)).rejects.toMatchObject({ code: "23505" });

        await client.query(`UPDATE contacts SET phone = NULL WHERE id = '${contactId}'`);
        expect((await client.query(`SELECT normalized_phone FROM contacts WHERE id = '${contactId}'`)).rows).toEqual([{ normalized_phone: null }]);
        expect((await client.query(`SELECT "primary", do_not_call_reason FROM contact_phones WHERE contact_id = '${contactId}'`)).rows).toEqual([
          { primary: false, do_not_call_reason: "Requested" },
        ]);

        await expect(client.exec(migration!.sql)).resolves.toBeDefined();
      } finally {
        await client.close();
      }
    });
  });

  it("serializes schema repair and applies only migrations whose marker is missing", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql === "marker:014") return { rows: [{ ready: queries.includes("migration:014") }] };
        if (sql === "marker:015") return { rows: [{ ready: true }] };
        return { rows: [] };
      },
      release() {
        queries.push("release");
      },
    };

    await runActReviewMigrations({
      pool: { connect: async () => client },
      migrations: [
        { name: "014", markerSql: "marker:014", sql: "migration:014" },
        { name: "015", markerSql: "marker:015", sql: "migration:015" },
      ],
    });

    expect(queries).toEqual([
      "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))",
      "marker:014",
      "migration:014",
      "marker:014",
      "marker:015",
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:act-review-migrations'))",
      "release",
    ]);
  });

  it("rolls back and releases the advisory lock when a migration fails", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql === "marker:014") return { rows: [{ ready: false }] };
        if (sql === "migration:014") throw new Error("migration failed");
        return { rows: [] };
      },
      release() {
        queries.push("release");
      },
    };

    await expect(
      runActReviewMigrations({
        pool: { connect: async () => client },
        migrations: [
          { name: "014", markerSql: "marker:014", sql: "migration:014" },
        ],
      }),
    ).rejects.toThrow("migration failed");

    expect(queries).toEqual([
      "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))",
      "marker:014",
      "migration:014",
      "ROLLBACK",
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:act-review-migrations'))",
      "release",
    ]);
  });
});


it("final review stops deployment when a migration remains unready after repair", async () => {
  const queries: string[] = [];
  await expect(runActReviewMigrations({ pool: { connect: async () => ({ query: async (sql: string) => { queries.push(sql); return { rows: [{ ready: false }] }; }, release: () => undefined }) }, migrations: [{ name: "partial-allocation", markerSql: "check", sql: "repair" }] })).rejects.toThrow(/remains incomplete after repair/);
  expect(queries.filter((q) => q === "check")).toHaveLength(2);
});
