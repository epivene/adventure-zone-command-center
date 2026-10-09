import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/auth", () => ({ requireOwnerMiddleware: (req: any, res: any, next: any) => req.headers.authorization === "test-owner" ? next() : res.status(401).json({ error: "Unauthorized" }) }));
import router from "./festival-crew";
import { PhotonGeocodingProvider, OverpassPlacesProvider } from "@/features/festival-crew/places-provider";
const id = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const base = `/event-profiles/${id}/editions/2026`, auth = { Authorization: "test-owner" };
let client: PGlite;
const app = express(); app.use(express.json()); app.use(router);
const input = { name: "QA RV stop", category: "rv_park", address: "Public RV park", latitude: null, longitude: null, sourceKey: null, sourceUrl: "", phone: "", website: "", notes: "Ask about long rigs", rigFit: "unknown", hookups: "unknown", overnight: "unknown", maxRigLengthFeet: null, expectedUpdatedAt: null };
beforeAll(async () => {
  client = new PGlite();
  await client.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY, name text); INSERT INTO organizations VALUES('${id}','Organizer mailing address is NOT the venue'),('${other}','Other organizer');`);
  for (const name of ["20261008_festival_editions.sql", "20261009_festival_crew_stops.sql", "20261009z_festival_crew_confirmations.sql"]) {
    const migration = await readFile(`../../lib/db/migrations/${name}`, "utf8"); await client.exec(migration); await client.exec(migration);
  }
  await client.exec(`INSERT INTO festival_editions(organization_id,year,details) VALUES('${id}',2026,'{"venue":"Actual 2026 venue","attendance":"1500","customFact":"Keep"}'),('${id}',2027,'{"venue":"Different 2027 venue"}'),('${other}',2026,'{"venue":"Other venue"}');`);
  state.db = drizzle(client);
});
afterAll(async () => { await client.close(); vi.restoreAllMocks(); });
describe("festival crew map data", () => {
  it("persists independent staff dates across reloads, unrelated edits and annual editions", async () => {
    const confirmed = { ...input, name: "Confirmed annual stop", rigFit: "yes", hookups: "no", overnight: "yes", rigFitConfirmedOn: "2026-10-01", hookupsConfirmedOn: "2026-09-30", overnightConfirmedOn: "2026-10-02" };
    const created = await request(app).post(`${base}/crew-stops`).set(auth).send(confirmed);
    expect(created.status).toBe(201);
    const saved = created.body;
    const reload = (await request(app).get(`${base}/crew-location`).set(auth)).body.stops.find((s: any) => s.id === saved.id);
    expect(reload).toMatchObject({ rigFitConfirmedOn: "2026-10-01", hookupsConfirmedOn: "2026-09-30", overnightConfirmedOn: "2026-10-02" });
    const edited = await request(app).put(`${base}/crew-stops/${saved.id}`).set(auth).send({ ...input, rigFit: "yes", hookups: "no", overnight: "yes", notes: "Unrelated note", expectedUpdatedAt: saved.updatedAt });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ rigFitConfirmedOn: reload.rigFitConfirmedOn, hookupsConfirmedOn: reload.hookupsConfirmedOn, overnightConfirmedOn: reload.overnightConfirmedOn });
    const nextYear = await request(app).post(`/event-profiles/${id}/editions/2027/crew-stops`).set(auth).send({ ...input, name: confirmed.name });
    expect(nextYear.status).toBe(201);
    expect(nextYear.body).toMatchObject({ rigFit: "unknown", rigFitConfirmedOn: null, hookupsConfirmedOn: null, overnight: "unknown", overnightConfirmedOn: null });
    expect((await request(app).put(`/event-profiles/${id}/editions/2027/crew-stops/${saved.id}`).set(auth).send({ ...confirmed, expectedUpdatedAt: edited.body.updatedAt })).status).toBe(404);
    const changed = await request(app).put(`${base}/crew-stops/${saved.id}`).set(auth).send({ ...input, rigFit: "yes", maxRigLengthFeet: 30, hookups: "yes", overnight: "unknown", expectedUpdatedAt: edited.body.updatedAt });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ rigFitConfirmedOn: null, hookupsConfirmedOn: null, overnightConfirmedOn: null });
    for (const stop of [changed.body, nextYear.body]) {
      const yearBase = stop.id === nextYear.body.id ? `/event-profiles/${id}/editions/2027` : base;
      expect((await request(app).delete(`${yearBase}/crew-stops/${stop.id}`).set(auth).send({ expectedUpdatedAt: stop.updatedAt })).status).toBe(204);
    }
  });
  it("rejects unknown, invalid and future confirmations and supports explicit clearing", async () => {
    for (const change of [
      { overnightConfirmedOn: "2026-10-01" },
      { rigFit: "yes", rigFitConfirmedOn: "2026-02-30" },
      { hookups: "no", hookupsConfirmedOn: "2999-01-01" },
      { overnight: "yes", overnightConfirmedOn: "2026-10-01T12:00:00Z" },
    ]) expect((await request(app).post(`${base}/crew-stops`).set(auth).send({ ...input, ...change })).status).toBe(400);
    const confirmed = { ...input, overnight: "no", overnightConfirmedOn: "2026-10-01" };
    const created = await request(app).post(`${base}/crew-stops`).set(auth).send(confirmed);
    expect(created.status).toBe(201);
    const cleared = await request(app).put(`${base}/crew-stops/${created.body.id}`).set(auth).send({ ...confirmed, overnightConfirmedOn: null, expectedUpdatedAt: created.body.updatedAt });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ overnight: "no", overnightConfirmedOn: null });
    await request(app).delete(`${base}/crew-stops/${created.body.id}`).set(auth).send({ expectedUpdatedAt: cleared.body.updatedAt });
  });
  it("requires owner authentication and valid scope", async () => {
    expect((await request(app).get(`${base}/crew-location`)).status).toBe(401);
    expect((await request(app).get("/event-profiles/not-a-uuid/editions/2026/crew-location").set(auth)).status).toBe(400);
  });
  it("never substitutes organizer location or another event year", async () => {
    const data = (await request(app).get(`${base}/crew-location`).set(auth)).body;
    expect(data.venue).toBe("Actual 2026 venue"); expect(data.location).toBeNull();
    expect((await request(app).get(`/event-profiles/${id}/editions/2028/crew-location`).set(auth)).body.venue).toBe("");
    expect((await request(app).post(`${base}/nearby/search`).set(auth).send({ radiusMiles: 25 })).status).toBe(409);
  });
  it("searching is read-only and saving a pin preserves annual facts and detects stale writes", async () => {
    vi.spyOn(PhotonGeocodingProvider.prototype, "geocode").mockResolvedValue([{ latitude: 43.7, longitude: -116.35, displayName: "Actual venue, Eagle" }]);
    const current = (await request(app).get(`${base}/crew-location`).set(auth)).body;
    const result = await request(app).post(`${base}/crew-location/search`).set(auth).send({ query: "Actual public venue" });
    expect(result.body.candidates).toHaveLength(1);
    expect((await request(app).get(`${base}/crew-location`).set(auth)).body.location).toBeNull();
    const pin = { ...result.body.candidates[0], expectedUpdatedAt: current.editionUpdatedAt };
    const saved = await request(app).put(`${base}/crew-location`).set(auth).send(pin);
    expect(saved.status).toBe(200); expect(saved.body.location.latitude).toBe(43.7);
    expect((await request(app).put(`${base}/crew-location`).set(auth).send(pin)).status).toBe(409);
    const facts = await client.query<{ details: any }>(`SELECT details FROM festival_editions WHERE organization_id='${id}' AND year=2026`);
    expect(facts.rows[0].details).toMatchObject({ attendance: "1500", customFact: "Keep" });
    expect((await request(app).get(`/event-profiles/${id}/editions/2027/crew-location`).set(auth)).body.location).toBeNull();
  });
  it("saved crew notes persist; update and remove are scoped and concurrency-protected", async () => {
    const created = await request(app).post(`${base}/crew-stops`).set(auth).send(input);
    expect(created.status).toBe(201);
    const stop = created.body;
    expect(stop.overnight).toBe("unknown");
    expect((await request(app).get(`${base}/crew-location`).set(auth)).body.stops[0].notes).toBe(input.notes);
    const edit = { ...input, notes: "Called staff: 45-foot rigs fit", rigFit: "yes", maxRigLengthFeet: 45, expectedUpdatedAt: stop.updatedAt };
    expect((await request(app).put(`/event-profiles/${other}/editions/2026/crew-stops/${stop.id}`).set(auth).send(edit)).status).toBe(404);
    const updated = await request(app).put(`${base}/crew-stops/${stop.id}`).set(auth).send(edit);
    expect(updated.status).toBe(200);
    expect((await request(app).put(`${base}/crew-stops/${stop.id}`).set(auth).send(edit)).status).toBe(409);
    expect((await request(app).delete(`${base}/crew-stops/${stop.id}`).set(auth).send({ expectedUpdatedAt: stop.updatedAt })).status).toBe(409);
    expect((await request(app).delete(`/event-profiles/${id}/editions/2027/crew-stops/${stop.id}`).set(auth).send({ expectedUpdatedAt: updated.body.updatedAt })).status).toBe(404);
    expect((await request(app).delete(`${base}/crew-stops/${stop.id}`).set(auth).send({ expectedUpdatedAt: updated.body.updatedAt })).status).toBe(204);
  });
  it("rejects unsafe URLs, partial coordinates and invalid category facts", async () => {
    for (const changes of [{ website: "javascript:alert(1)" }, { latitude: 43.7 }, { rigFit: "sure" }, { category: "hotel" }, { name: "  " }, { latitude: 91, longitude: 0 }]) {
      expect((await request(app).post(`${base}/crew-stops`).set(auth).send({ ...input, ...changes })).status).toBe(400);
    }
  });
  it("prevents repeated OSM suggestion saves and never grants Walmart overnight permission", async () => {
    const walmart = { ...input, name: "Walmart", category: "walmart", sourceKey: "node/99", sourceUrl: "https://www.openstreetmap.org/node/99" };
    const first = await request(app).post(`${base}/crew-stops`).set(auth).send(walmart);
    expect(first.status).toBe(201); expect(first.body.overnight).toBe("unknown");
    expect(first.body).toMatchObject({ rigFitConfirmedOn: null, hookupsConfirmedOn: null, overnightConfirmedOn: null });
    expect((await request(app).post(`${base}/crew-stops`).set(auth).send(walmart)).status).toBe(409);
  });
  it("clears a stale pin when annual venue changes and handles provider outage honestly", async () => {
    vi.spyOn(OverpassPlacesProvider.prototype, "search").mockResolvedValue({ suggestions: [], searchedAt: new Date().toISOString(), radiusMiles: 25 });
    expect((await request(app).post(`${base}/nearby/search`).set(auth).send({ radiusMiles: 25 })).status).toBe(200);
    const walmart = (await request(app).get(`${base}/crew-location`).set(auth)).body.stops.find((s: any) => s.category === "walmart");
    expect(walmart).toMatchObject({ overnight: "unknown", overnightConfirmedOn: null });
    await client.exec(`UPDATE festival_editions SET details = details || '{"venue":"Moved venue"}' WHERE organization_id='${id}' AND year=2026`);
    expect((await request(app).get(`${base}/crew-location`).set(auth)).body.location).toBeNull();
    expect((await request(app).post(`${base}/nearby/search`).set(auth).send({ radiusMiles: 25 })).status).toBe(409);
  });
});
