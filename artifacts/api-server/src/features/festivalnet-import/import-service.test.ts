import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SQL, eq, sql } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { organizations, contacts, organizationContacts, festivalEditions, actContactSyncStates } from "@/db/schema";
import type { FestivalNetDraft } from "@workspace/api-zod";

const mocked = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: mocked }));
import { applyFestivalNetDraft, fillMissing, ImportConflict } from "./import-service";

let client: PGlite;
let database: ReturnType<typeof drizzle>;
const draft = (): FestivalNetDraft => ({
  name: "Example Arts Festival", year: 2026,
  sourceUrl: "https://festivalnet.com/999999001/Example-Arts-Festival", sourceFilename: "festival.pdf",
  city: "Eagle", region: "ID", phone: "208-555-0100",
  contactName: "Example Director", contactEmail: "director@example.org", contactPhone: "208-555-0101",
  details: { startsOn: "2026-10-03", endsOn: "2026-10-10", attendance: "1,500" },
});

beforeEach(async () => {
  client = new PGlite(); database = drizzle(client);
  const dialect = new PgDialect();
  for (const table of [organizations, contacts, organizationContacts, festivalEditions, actContactSyncStates]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      let defaultSql = "";
      if (column.default instanceof SQL) defaultSql = dialect.sqlToQuery(column.default).sql;
      else if (column.default !== undefined) {
        const value = typeof column.default === "object" ? JSON.stringify(column.default) : column.default;
        defaultSql = typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value);
      }
      return `"${column.name}" ${column.getSQLType()} ${column.notNull ? "not null" : ""} ${column.primary ? "primary key" : ""} ${defaultSql ? `default ${defaultSql}` : ""}`;
    });
    await client.exec(`create table "${config.name}" (${columns.join(",")})`);
  }
  await client.exec("create unique index on festival_editions(organization_id,year); create function pg_advisory_xact_lock(integer) returns integer language sql as $$ select 1 $$;");
  mocked.transaction.mockImplementation((callback) => database.transaction(callback));
});
afterEach(async () => { await client?.close(); });

describe("non-destructive FestivalNet import", () => {
  it("creates a profile, linked primary director and event year; re-import adds no duplicates", async () => {
    const first = await applyFestivalNetDraft(draft(), null);
    const again = await applyFestivalNetDraft(draft(), first.organizationId);
    expect(first.created).toBe(true); expect(again.created).toBe(false);
    expect(again.filledFields).toEqual([]);
    expect(await database.select().from(organizations)).toHaveLength(1);
    expect(await database.select().from(contacts)).toHaveLength(1);
    expect(await database.select().from(organizationContacts)).toMatchObject([{ isPrimary: true }]);
    expect(await database.select().from(festivalEditions)).toHaveLength(1);
  });
  it("preserves populated profile, annual and contact fields, including the current primary", async () => {
    const first = await applyFestivalNetDraft(draft(), null);
    await database.update(organizations).set({ phone: "kept phone" }).where(eq(organizations.id, first.organizationId));
    await database.update(festivalEditions).set({ details: { attendance: "9,000", description: "Keep this description" } });
    await database.update(contacts).set({ phone: "kept director phone" });
    const result = await applyFestivalNetDraft(draft(), first.organizationId);
    expect(result.preservedFields).toEqual(expect.arrayContaining(["phone", "details.attendance", "contactPhone"]));
    expect((await database.select().from(organizations))[0].phone).toBe("kept phone");
    expect((await database.select().from(festivalEditions))[0].details).toMatchObject({ attendance: "9,000", description: "Keep this description", startsOn: "2026-10-03" });
    const changed = draft(); changed.contactName = "Second Director"; changed.contactEmail = "second@example.org";
    await applyFestivalNetDraft(changed, first.organizationId);
    const links = await database.select().from(organizationContacts);
    expect(links.filter(link => link.isPrimary)).toHaveLength(1);
    expect(links).toHaveLength(2);
  });
  it("blocks an explicit new profile if a match appeared after preview", async () => {
    await applyFestivalNetDraft(draft(), null);
    await expect(applyFestivalNetDraft(draft(), null)).rejects.toBeInstanceOf(ImportConflict);
    expect(await database.select().from(organizations)).toHaveLength(1);
  });
  it("rolls back the entire import when a later contact operation fails", async () => {
    await client.exec("drop table act_contact_sync_states");
    await expect(applyFestivalNetDraft(draft(), null)).rejects.toThrow();
    expect(await database.select().from(organizations)).toHaveLength(0);
    expect(await database.select().from(festivalEditions)).toHaveLength(0);
    expect(await database.select().from(contacts)).toHaveLength(0);
  });
  it("adds another event year without modifying the earlier year", async () => {
    const first = await applyFestivalNetDraft(draft(), null);
    const next = draft(); next.year = 2027;
    next.details = { startsOn: "2027-10-03", endsOn: "2027-10-10" };
    await applyFestivalNetDraft(next, first.organizationId);
    const years = await database.select().from(festivalEditions);
    expect(years).toHaveLength(2);
    expect(years.find(year => year.year === 2026)?.details.startsOn).toBe("2026-10-03");
  });
  it("only fills empty strings/null and never treats zero or no as absent", () => {
    const result = fillMissing({ empty: " ", null: null, attendance: "0", insurance: "No" }, { empty: "new", null: "new", attendance: "9", insurance: "Yes" });
    expect(result.values).toEqual({ empty: "new", null: "new" });
    expect(result.preserved).toEqual(["attendance", "insurance"]);
  });
});
