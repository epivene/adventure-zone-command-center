import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgTable, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { executeProfileMerge } from "./profile-merge-executor";

it("runs the production executor on a pinned client and preserves core relationships", async () => {
  const db = new PGlite();
  try {
    // Schema-derived columns exercise real repository SQL. Production FK/unique
    // constraints remain covered by organization-merge.integration.test.ts on PostgreSQL.
    const names = new Set<string>();
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const t = getTableConfig(value);
      if (names.has(t.name)) continue;
      names.add(t.name);
      const columns = t.columns.map((c) => {
        const type = c.enumValues?.length ? "text" : c.getSQLType();
        let def = "";
        if (c.name === "id" && type === "uuid")
          def = " DEFAULT gen_random_uuid()";
        if (is(c.default, SQL)) {
          const q = new PgDialect().sqlToQuery(c.default.getSQL());
          if (!q.params.length) def = " DEFAULT " + q.sql;
        }
        return `"${c.name}" ${type}${def}`;
      });
      await db.exec(`CREATE TABLE "${t.name}" (${columns.join(",")})`);
    }
    await db.exec(
      "CREATE TABLE convention_members(id uuid,organization_id uuid)",
    );
    await db.exec(
      "CREATE UNIQUE INDEX merge_org_contact ON organization_contacts(organization_id,contact_id); CREATE UNIQUE INDEX merge_queue_override ON booking_opportunity_queue_overrides(opportunity_id,business_date)",
    );
    const primary = "10000000-0000-4000-8000-000000000001",
      duplicate = "10000000-0000-4000-8000-000000000002";
    await db.query(
      "INSERT INTO organizations(id,name,city,region) VALUES($1,'County Fair','Town','UT'),($2,'County Fair old','Town','UT')",
      [primary, duplicate],
    );
    const contact = "20000000-0000-4000-8000-000000000001";
    await db.query(
      "INSERT INTO contacts(id,organization_id,first_name) VALUES($1,$2,'Serena')",
      [contact, duplicate],
    );
    await db.query(
      "INSERT INTO organization_contacts(organization_id,contact_id,is_primary,active) VALUES($1,$2,true,true)",
      [duplicate, contact],
    );
    await db.query(
      "INSERT INTO bookings(organization_id,name,status) VALUES($1,'2027 booking','confirmed')",
      [duplicate],
    );
    await db.query(
      "INSERT INTO activities(organization_id,kind,body) VALUES($1,'note','Original note')",
      [duplicate],
    );
    await db.query(
      "INSERT INTO follow_ups(organization_id,kind) VALUES($1,'COI renewal')",
      [duplicate],
    );
    await db.query(
      "INSERT INTO business_document_links(organization_id,target_kind,document_id) VALUES($1,'profile',gen_random_uuid())",
      [duplicate],
    );
    await db.transaction(async (tx) => {
      // Adapts PGlite result rows to node-postgres's query-config/array contract.
      const client = {
        query: async (config: any, params: any[] = []) => {
          const result = await tx.query(
            typeof config === "string" ? config : config.text,
            params,
          );
          return {
            ...result,
            rows:
              config.rowMode === "array"
                ? result.rows.map((row: any) =>
                    result.fields.map((field: any) => row[field.name]),
                  )
                : result.rows,
          };
        },
      };
      await executeProfileMerge(client, primary, [duplicate]);
    });
    expect((await db.query("SELECT id FROM organizations")).rows).toEqual([
      { id: primary },
    ]);
    expect(
      (await db.query("SELECT organization_id,first_name FROM contacts")).rows,
    ).toEqual([{ organization_id: primary, first_name: "Serena" }]);
    expect(
      (await db.query("SELECT organization_id,body FROM activities")).rows,
    ).toEqual([{ organization_id: primary, body: "Original note" }]);
    for (const table of ["bookings", "follow_ups", "business_document_links"])
      expect(
        (await db.query(`SELECT organization_id FROM ${table}`)).rows,
      ).toEqual([{ organization_id: primary }]);
  } finally {
    await db.close();
  }
});
