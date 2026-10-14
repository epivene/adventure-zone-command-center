import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  ensureChatGPTConnectionSchema,
  isChatGPTConnectionSchemaReady,
} from "./chatgpt-connection-schema";

it("installs missing schema and then only reads catalogs on subsequent launches", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE organizations(id uuid PRIMARY KEY)");
    expect(await isChatGPTConnectionSchemaReady(db)).toBe(false);
    await ensureChatGPTConnectionSchema(db);
    expect(await isChatGPTConnectionSchemaReady(db)).toBe(true);
    const queries: string[] = [];
    await ensureChatGPTConnectionSchema({
      query: async (sql, params) => {
        queries.push(sql);
        return db.query(sql, params);
      },
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toMatch(/ALTER TABLE|CREATE TABLE/);
  } finally {
    await db.close();
  }
});
it("detects incomplete schemas and leaves existing CRM values intact", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY,description text); INSERT INTO organizations VALUES(gen_random_uuid(),'Keep this description'); CREATE TABLE chatgpt_connections(id uuid PRIMARY KEY)",
    );
    expect(await isChatGPTConnectionSchemaReady(db)).toBe(false);
    expect(
      (await db.query("SELECT description FROM organizations")).rows[0],
    ).toEqual({ description: "Keep this description" });
  } finally {
    await db.close();
  }
});

it("runs required startup as an atomic real SQL transaction", async () => {
  const { ensureChatGPTConnectionSchemaBeforeListen } =
    await import("./chatgpt-connection-required-startup");
  const db = new PGlite();
  const released: boolean[] = [];
  const pool = {
    connect: async () => ({
      query: (sql: string) => db.query<Record<string, unknown>>(sql),
      release: (destroy = false) => {
        released.push(destroy);
      },
    }),
  };
  try {
    await db.exec("CREATE TABLE organizations(id uuid PRIMARY KEY)");
    await ensureChatGPTConnectionSchemaBeforeListen({ pool });
    expect(await isChatGPTConnectionSchemaReady(db)).toBe(true);
    await ensureChatGPTConnectionSchemaBeforeListen({ pool });
    expect(released).toEqual([false, false]);
    await expect(
      ensureChatGPTConnectionSchemaBeforeListen({
        pool,
        ensureSchema: async (client) => {
          await client.query("CREATE TABLE rollback_probe(id integer)");
          throw Error("simulated DDL failure");
        },
      }),
    ).rejects.toThrow("simulated DDL failure");
    expect(
      (await db.query("SELECT to_regclass('rollback_probe') AS relation"))
        .rows[0],
    ).toEqual({ relation: null });
    expect(released.at(-1)).toBe(true);
  } finally {
    await db.close();
  }
});
