import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import {
  ensureComputerCallingSchemaBeforeListen,
  computerCallingReadySql,
} from "./computer-calling-required-startup";
it("repairs old methods, preserves call history, then starts without DDL", async () => {
  const db = new PGlite();
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      const r = await db.exec(sql);
      return { rows: (r.at(-1)?.rows ?? []) as Array<Record<string, unknown>> };
    },
    release: vi.fn(),
  };
  const run = () =>
    ensureComputerCallingSchemaBeforeListen({
      pool: { connect: async () => client },
    });
  const ready = async () => (await db.query(computerCallingReadySql)).rows;
  try {
    await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE contacts(id uuid PRIMARY KEY); CREATE TABLE contact_phones(id uuid PRIMARY KEY);
 CREATE TABLE call_sessions(id int PRIMARY KEY, method text CONSTRAINT call_sessions_method_valid CHECK(method IN ('standard_call','office_call','individual_voicemail','mobile_log')));
 INSERT INTO call_sessions VALUES(1,'standard_call');`);
    expect(await ready()).toEqual([{ ready: false }]);
    await run();
    expect(await ready()).toEqual([{ ready: true }]);
    expect((await db.query("SELECT * FROM call_sessions")).rows).toEqual([
      { id: 1, method: "standard_call" },
    ]);
    await db.exec("INSERT INTO call_sessions VALUES(2,'browser_voip')");
    await expect(
      db.exec("INSERT INTO call_sessions VALUES(3,'unknown_method')"),
    ).rejects.toThrow();
    statements.length = 0;
    await run();
    expect(
      statements.some((s) => /CREATE TABLE|ALTER TABLE|advisory/.test(s)),
    ).toBe(false);
    await db.exec("DROP INDEX computer_call_sessions_phone_id_idx");
    expect(await ready()).toEqual([{ ready: false }]);
    await run();
    expect(await ready()).toEqual([{ ready: true }]);
    await db.exec(
      "BEGIN; ALTER TABLE computer_call_sessions DROP COLUMN error_summary",
    );
    expect(await ready()).toEqual([{ ready: false }]);
    await db.exec("ROLLBACK");
    // A constraint with the right name but only one allowed method is not ready.
    await db.exec(
      "BEGIN; ALTER TABLE call_sessions DROP CONSTRAINT call_sessions_method_valid; ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_method_valid CHECK(method IN ('browser_voip')) NOT VALID;",
    );
    expect(await ready()).toEqual([{ ready: false }]);
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});
