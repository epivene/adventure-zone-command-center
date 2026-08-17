import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  createProfileLifecycleRouter,
  type ProfileLifecycleRouteService,
} from "./profile-lifecycle";

const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const ARCHIVED_AT = new Date("2026-08-16T22:00:00Z");

function service(): ProfileLifecycleRouteService {
  return {
    listArchived: vi.fn(async () => [{
      id: PROFILE_ID,
      name: "16th Street Fair",
      city: "Denver",
      region: "CO",
      archivedAt: ARCHIVED_AT,
    }]),
    archive: vi.fn(async () => ({ id: PROFILE_ID, archivedAt: ARCHIVED_AT })),
    restore: vi.fn(async () => ({ id: PROFILE_ID, archivedAt: null })),
  };
}

function app(lifecycle: ProfileLifecycleRouteService) {
  const app = express();
  app.use(express.json());
  app.use(createProfileLifecycleRouter({ service: lifecycle }));
  return app;
}

describe("profile lifecycle routes", () => {
  it("lists archived profiles", async () => {
    const lifecycle = service();
    const response = await request(app(lifecycle)).get("/profile-lifecycle/archived");

    expect(response.status).toBe(200);
    expect(response.body.profiles).toEqual([{
      id: PROFILE_ID,
      name: "16th Street Fair",
      city: "Denver",
      region: "CO",
      archivedAt: ARCHIVED_AT.toISOString(),
    }]);
  });

  it("archives and restores the same profile", async () => {
    const lifecycle = service();
    const server = app(lifecycle);

    const archived = await request(server).post(`/profile-lifecycle/${PROFILE_ID}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.profile).toEqual({ id: PROFILE_ID, archivedAt: ARCHIVED_AT.toISOString() });
    expect(lifecycle.archive).toHaveBeenCalledWith(PROFILE_ID, "owner");

    const restored = await request(server).post(`/profile-lifecycle/${PROFILE_ID}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.profile).toEqual({ id: PROFILE_ID, archivedAt: null });
    expect(lifecycle.restore).toHaveBeenCalledWith(PROFILE_ID, "owner");
  });

  it("rejects invalid IDs and maps missing profiles to 404", async () => {
    const lifecycle = service();
    const server = app(lifecycle);

    expect((await request(server).post("/profile-lifecycle/not-a-uuid/archive")).status).toBe(400);
    expect(lifecycle.archive).not.toHaveBeenCalled();

    lifecycle.archive = vi.fn(async () => {
      throw Object.assign(new Error("missing"), { code: "PROFILE_NOT_FOUND" });
    });
    const missing = await request(server).post(`/profile-lifecycle/${PROFILE_ID}/archive`);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ ok: false, error: "Profile not found." });
  });
});
