import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const listAvailableTravelLegs = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/organization-locations/location-repository", () => ({
  DrizzleLocationRepository: class {
    listAvailableTravelLegs = listAvailableTravelLegs;
  },
}));

import locationRoutes from "./organization-locations";

describe("organization location options route", () => {
  it("serves travel-leg options before treating options as a location id", async () => {
    listAvailableTravelLegs.mockResolvedValueOnce([
      { id: "leg-1", name: "Northern route" },
    ]);
    const app = express();
    app.use("/api/organizations/:id/locations", locationRoutes);

    const response = await request(app).get(
      "/api/organizations/5256fc81-97ff-423c-acd7-049f7b83041c/locations/options/travel-legs",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      travelLegs: [{ id: "leg-1", name: "Northern route" }],
    });
  });
});
