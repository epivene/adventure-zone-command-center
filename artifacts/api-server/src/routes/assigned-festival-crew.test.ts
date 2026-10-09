import express, { type RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssignedFestivalCrewRouter } from "./assigned-festival-crew";
import { AssignedCrewService } from "@/features/festival-crew/assigned-crew-service";
import type { OperationsBaseRecord } from "@/features/bookings/booking-leg-operations-repository";

const id = "e19a67ac-3908-4fc1-a165-0a1d2ce7b8ca";
const profile = "e19a67ac-3908-4fc1-a165-0a1d2ce7b8cb";
const loadBase = vi.fn();
const loadCrew = vi.fn();
const auth: RequestHandler = (req, res, next) => {
  if (req.headers.authorization !== "Bearer manager-session") { res.sendStatus(401); return; }
  req.legManager = { legId: "leg-a", managerName: "Test" }; next();
};
function base(leg: string | null = "leg-a", year: number | null = 2026, profileId: string | null = profile) {
  return { booking: { travelLegId: leg, seasonYear: year, profileId } } as OperationsBaseRecord;
}
function app() {
  const app = express();
  app.use(createAssignedFestivalCrewRouter({ service: new AssignedCrewService({ loadBase }, loadCrew), requireManager: auth, requireBoss: auth }));
  return app;
}
const read = (role = "manager", suffix = "") => request(app()).get(`/${role}/bookings/${id}/crew-location${suffix}`).set("Authorization", "Bearer manager-session");
const crew = {
  venue: "Annual fairgrounds", editionUpdatedAt: null, location: { latitude: 40, longitude: -105, displayName: "Gate" },
  stops: [{ id: profile, name: "Walmart", category: "walmart", address: "1 Main", latitude: null, longitude: null,
    sourceKey: null, sourceUrl: "", website: "", phone: "", notes: "Ask store staff",
    rigFit: "unknown", hookups: "unknown", overnight: "unknown", maxRigLengthFeet: null,
    expectedUpdatedAt: null, updatedAt: "2026-10-09T10:00:00.000Z" }],
};
beforeEach(() => { vi.resetAllMocks(); loadBase.mockResolvedValue(base()); loadCrew.mockResolvedValue(crew); });
describe("assigned festival crew read access", () => {
  it("requires role authentication, validates IDs and has no write endpoints", async () => {
    for (const role of ["manager", "boss"]) {
      expect((await request(app()).get(`/${role}/bookings/${id}/crew-location`)).status).toBe(401);
      expect((await request(app()).get(`/${role}/bookings/bad/crew-location`).set("Authorization", "Bearer manager-session")).status).toBe(400);
      for (const method of ["post", "put", "delete"] as const) {
        expect((await request(app())[method](`/${role}/bookings/${id}/crew-location`).set("Authorization", "Bearer manager-session")).status).toBe(404);
      }
    }
    expect(loadCrew).not.toHaveBeenCalled();
  });
  it("reads only the server-resolved linked annual edition and strips private fields", async () => {
    loadCrew.mockResolvedValue({ ...crew, organizerNotes: "private", email: "private@example.test" });
    const response = await read("manager", "?profileId=another&year=2025");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(loadBase).toHaveBeenCalledWith(id, { kind: "manager", legId: "leg-a" });
    expect(loadCrew).toHaveBeenCalledWith(profile, 2026);
    expect(response.body).toEqual({ bookingId: id, year: 2026, crewLocation: crew });
    expect(response.body.crewLocation.stops[0].overnight).toBe("unknown");
  });
  it("blocks other-leg and unassigned events before reading any profile", async () => {
    for (const leg of ["leg-b", null]) {
      loadBase.mockResolvedValue(base(leg));
      expect((await read()).status).toBe(403);
    }
    expect(loadCrew).not.toHaveBeenCalled();
  });
  it("keeps Boss initial assignment visibility without allowing unassigned access", async () => {
    loadBase.mockResolvedValue(base(null));
    expect((await read("boss")).status).toBe(403);
    expect(loadCrew).not.toHaveBeenCalled();
    loadBase.mockResolvedValue(base("leg-b"));
    expect((await read("boss")).status).toBe(200);
    expect(loadBase).toHaveBeenCalledWith(id, { kind: "boss" });
  });
  it("does not guess another year/profile for missing links, dates or editions", async () => {
    for (const record of [base("leg-a", null), base("leg-a", 2026, null)]) {
      loadBase.mockResolvedValue(record);
      const response = await read();
      expect(response.status).toBe(200); expect(response.body.crewLocation).toBeNull();
    }
    expect(loadCrew).not.toHaveBeenCalled();
    loadBase.mockResolvedValue(base("leg-a", 2025));
    loadCrew.mockResolvedValue({ venue: "", editionUpdatedAt: null, location: null, stops: [] });
    expect((await read()).body).toEqual({ bookingId: id, year: 2025, crewLocation: { venue: "", editionUpdatedAt: null, location: null, stops: [] } });
    expect(loadCrew).toHaveBeenCalledWith(profile, 2025);
  });
  it("reports missing bookings and service failures without leaking stored data", async () => {
    loadBase.mockResolvedValue(null);
    expect((await read()).status).toBe(404);
    loadBase.mockResolvedValue(base());
    loadCrew.mockRejectedValue(new Error("private database detail"));
    const response = await read();
    expect(response.status).toBe(503); expect(response.text).not.toContain("private database detail");
  });
});
