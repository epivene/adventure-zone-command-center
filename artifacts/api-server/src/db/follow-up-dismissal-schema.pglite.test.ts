import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import {
  ensureFollowUpDismissalPersistenceBeforeListen,
  followUpDismissalReadySql,
} from "./follow-up-dismissal-required-startup";
it("repairs the old broad trigger, preserves reminders, and skips installed DDL", async () => {
  const db = new PGlite();
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      const results = await db.exec(sql);
      return {
        rows: (results.at(-1)?.rows ?? []) as Array<Record<string, unknown>>,
      };
    },
    release: vi.fn(),
  };
  try {
    await db.exec(`CREATE TABLE follow_ups(id int PRIMARY KEY, organization_id int, organization_location_id int, status text);
 INSERT INTO follow_ups VALUES(1,1,2,'open');
 CREATE FUNCTION check_organization_location_org_match() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id <> NEW.organization_location_id THEN RAISE EXCEPTION 'location mismatch'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER follow_ups_location_org_match BEFORE INSERT OR UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION check_organization_location_org_match();`);
    expect((await db.query(followUpDismissalReadySql)).rows).toEqual([
      { ready: false },
    ]);
    await ensureFollowUpDismissalPersistenceBeforeListen({
      pool: { connect: async () => client },
    });
    expect((await db.query(followUpDismissalReadySql)).rows).toEqual([
      { ready: true },
    ]);
    await db.exec("UPDATE follow_ups SET status='dismissed' WHERE id=1");
    expect((await db.query("SELECT * FROM follow_ups")).rows).toEqual([
      {
        id: 1,
        organization_id: 1,
        organization_location_id: 2,
        status: "dismissed",
      },
    ]);
    await expect(
      db.exec("UPDATE follow_ups SET organization_id=3 WHERE id=1"),
    ).rejects.toThrow("location mismatch");
    statements.length = 0;
    await ensureFollowUpDismissalPersistenceBeforeListen({
      pool: { connect: async () => client },
    });
    expect(
      statements.some((s) => /DROP TRIGGER|CREATE TRIGGER|advisory/.test(s)),
    ).toBe(false);
    await db.exec(
      "ALTER TABLE follow_ups DISABLE TRIGGER follow_ups_location_org_match",
    );
    expect((await db.query(followUpDismissalReadySql)).rows).toEqual([
      { ready: false },
    ]);
    await ensureFollowUpDismissalPersistenceBeforeListen({
      pool: { connect: async () => client },
    });
    expect((await db.query(followUpDismissalReadySql)).rows).toEqual([
      { ready: true },
    ]);
  } finally {
    await db.close();
  }
});
