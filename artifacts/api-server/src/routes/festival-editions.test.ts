import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/auth", () => ({ requireOwnerMiddleware: (req: any, res: any, next: any) => req.headers.authorization === "test-owner" ? next() : res.status(401).json({ error: "Unauthorized" }) }));
import router from "./festival-editions";

const id = "10000000-0000-4000-8000-000000000001";
let client: PGlite;
function app() {
  const application = express();
  application.use(express.json());
  application.use((req: any, _res, next) => { req.log = { error: vi.fn() }; next(); });
  application.use(router);
  return application;
}
const auth = { Authorization: "test-owner" };
beforeEach(async () => {
  client = new PGlite();
  await client.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY, name text); INSERT INTO organizations VALUES('${id}', 'Preserved organizer');`);
  const migration = await readFile("../../lib/db/migrations/20261008_festival_editions.sql", "utf8");
  await client.exec(migration);
  await client.exec(migration);
  state.db = drizzle(client);
});
afterEach(async () => { await client.close(); });

describe("festival editions", () => {
  it("requires an owner session for reads and writes", async () => {
    expect((await request(app()).get(`/event-profiles/${id}/editions`)).status).toBe(401);
    expect((await request(app()).put(`/event-profiles/${id}/editions/2027`).send({ details: {}, expectedUpdatedAt: null })).status).toBe(401);
  });
  it("keeps annual details separate and preserves the organizer", async () => {
    const first = await request(app()).put(`/event-profiles/${id}/editions/2027`).set(auth).send({ details: { startsOn: "2027-08-21", boothFee: "$325" }, expectedUpdatedAt: null });
    expect(first.status).toBe(200);
    expect(first.body.details.boothFee).toBe("$325");
    expect((await request(app()).put(`/event-profiles/${id}/editions/2028`).set(auth).send({ details: { boothFee: "$350" }, expectedUpdatedAt: null })).status).toBe(200);
    const list = await request(app()).get(`/event-profiles/${id}/editions`).set(auth);
    expect(list.body.editions.map((row: any) => row.year)).toEqual([2028, 2027]);
    expect(list.body.editions[1].details.startsOn).toBe("2027-08-21");
    expect((await client.query<{ name: string }>("SELECT name FROM organizations")).rows[0]?.name).toBe("Preserved organizer");
  });
  it("rejects stale writes and duplicate additions without replacing details", async () => {
    const first = await request(app()).put(`/event-profiles/${id}/editions/2027`).set(auth).send({ details: { hours: "10–5" }, expectedUpdatedAt: null });
    const second = await request(app()).put(`/event-profiles/${id}/editions/2027`).set(auth).send({ details: { hours: "10–6" }, expectedUpdatedAt: first.body.updatedAt });
    expect(second.status).toBe(200);
    const stale = await request(app()).put(`/event-profiles/${id}/editions/2027`).set(auth).send({ details: { hours: "lost update" }, expectedUpdatedAt: first.body.updatedAt });
    expect(stale.status).toBe(409);
    const duplicate = await request(app()).put(`/event-profiles/${id}/editions/2027`).set(auth).send({ details: {}, expectedUpdatedAt: null });
    expect(duplicate.status).toBe(409);
  });
  it("validates real calendar dates, year ranges and safe links", async () => {
    for (const details of [{ startsOn: "2027-02-30" }, { startsOn: "2027-08-22", endsOn: "2027-08-21" }, { applicationUrl: "javascript:alert(1)" }]) {
      expect((await request(app()).put(`/event-profiles/${id}/editions/2027`).set(auth).send({ details, expectedUpdatedAt: null })).status).toBe(400);
    }
    expect((await request(app()).put(`/event-profiles/${id}/editions/2300`).set(auth).send({ details: {}, expectedUpdatedAt: null })).status).toBe(400);
  });
});
