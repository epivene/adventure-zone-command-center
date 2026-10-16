import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute } }));
import router from "./event-profile-description";

it("reads and saves descriptions without requiring a table schema lock", async () => {
  const dialect = new PgDialect();
  execute.mockImplementation(async (query) => {
    const { sql } = dialect.sqlToQuery(query);
    if (/alter table/i.test(sql)) throw new Error("Schema changes unavailable during customer requests");
    return { rows: [{ id: "10000000-0000-4000-8000-000000000001", description: "Annual event" }] };
  });
  const app = express().use(express.json()).use((req, _res, next) => {
    req.log = { error() {} } as any; next();
  }).use(router);
  const url = "/event-profiles/10000000-0000-4000-8000-000000000001/description";
  const read = await request(app).get(url);
  expect(read.status).toBe(200);
  expect(read.body.description).toBe("Annual event");
  const saved = await request(app).patch(url).send({ description: " Updated event " });
  expect(saved.status).toBe(200);
  expect(saved.body).toEqual({ ok: true, description: "Updated event" });
});
