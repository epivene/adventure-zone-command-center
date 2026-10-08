import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as any, manual: vi.fn() }));
vi.mock("@workspace/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/auth", () => ({ requireOwnerMiddleware: (req: any, res: any, next: any) => req.headers.authorization === "test-owner" ? next() : res.status(401).json({ error: "Unauthorized" }) }));
vi.mock("@/features/outreach-planner/outreach-commitments", () => ({ commitmentTransaction: (db: any, callback: any) => db.transaction(callback) }));
vi.mock("@/features/leg-assignment/leg-assignment-repository", () => ({ LegAssignmentRepository: class {} }));
vi.mock("@/features/leg-assignment/drive-time-estimator", () => ({ RouteDriveTimeEstimator: class {} }));
vi.mock("@/features/leg-assignment/leg-assignment-service", () => ({ LegAssignmentService: class { recordManualAssignment = state.manual; } }));
import router from "./lead-leg-assignment";

const booking = "10000000-0000-4000-8000-000000000001";
const leg = "10000000-0000-4000-8000-000000000002";
let client: PGlite;
const app = () => {
  const application = express(); application.use(express.json());
  application.use((req: any, _res, next) => { req.log = { error: vi.fn() }; next(); });
  application.use(router); return application;
};
beforeEach(async () => {
  client = new PGlite();
  await client.exec(`CREATE TABLE bookings(id uuid PRIMARY KEY, status text, travel_leg_id uuid); CREATE TABLE travel_legs(id uuid PRIMARY KEY, archived_at timestamptz); INSERT INTO bookings VALUES('${booking}', 'new_lead', NULL); INSERT INTO travel_legs VALUES('${leg}', NULL);`);
  state.db = drizzle(client);
  state.manual.mockReset().mockResolvedValue({ assignedLegId: leg, suggestedLegId: leg, source: "manual" });
});
afterEach(async () => { await client.close(); });
const save = (expectedTravelLegId: string | null = null) => request(app()).post(`/bookings/${booking}/lead-leg`).set("Authorization", "test-owner").send({ travelLegId: leg, expectedTravelLegId });

describe("lead leg assignment boundary", () => {
  it("requires owner authorization and accepts an active leg for a lead", async () => {
    expect((await request(app()).post(`/bookings/${booking}/lead-leg`).send({ travelLegId: leg, expectedTravelLegId: null })).status).toBe(401);
    expect((await save()).status).toBe(200);
    expect(state.manual).toHaveBeenCalledWith(booking, leg);
  });
  it("rejects stale choices and archived legs without changing assignments", async () => {
    await client.exec(`UPDATE bookings SET travel_leg_id = '${leg}'`);
    expect((await save()).status).toBe(409);
    await client.exec(`UPDATE travel_legs SET archived_at = now()`);
    expect((await save(leg)).status).toBe(400);
    expect(state.manual).not.toHaveBeenCalled();
  });
  it("does not reassign confirmed bookings through the lead workflow", async () => {
    await client.exec("UPDATE bookings SET status = 'confirmed'");
    expect((await save()).status).toBe(409);
    expect(state.manual).not.toHaveBeenCalled();
  });
});
