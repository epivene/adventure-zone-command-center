import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const hierarchy = vi.hoisted(() => ({
  setOrganizationParent: vi.fn(),
  createOrganizationParent: vi.fn(),
  ungroupOrganization: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));

vi.mock("@/features/organizations/last-resort-input", () => ({
  organizationListQuerySchema: z.object({}).transform(() => ({
    search: "",
    lastResort: "all",
    travelLegId: null,
    page: 1,
    pageSize: 50,
  })),
  setLastResortInputSchema: z.object({
    organizationId: z.string().uuid(),
    enabled: z.boolean(),
    reason: z.string(),
  }),
}));

vi.mock("@/features/organizations/organization-repository", () => ({
  DrizzleOrganizationRepository: class {},
}));

vi.mock("@/features/routes/travel-leg-repository", () => ({
  DrizzleTravelLegRepository: class {},
}));

vi.mock("@/features/activities/activity-service", () => ({
  ActivityService: class {},
}));

vi.mock("@/features/activities/activity-repository", () => ({
  DrizzleActivityRepository: class {},
}));

vi.mock("@/features/organizations/organization-hierarchy", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/organizations/organization-hierarchy")
  >();
  return { ...actual, ...hierarchy };
});

import { HierarchyConflictError } from "@/features/organizations/organization-hierarchy";
import router from "./organizations";

const CHILD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CHILD_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";

function testApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: (...args: unknown[]) => void } }).log = {
      error: vi.fn(),
    };
    next();
  });
  app.use("/api", router);
  return app;
}

describe("organization hierarchy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches a location to an existing parent", async () => {
    hierarchy.setOrganizationParent.mockResolvedValue(undefined);

    const response = await request(testApp())
      .post("/api/organizations/hierarchy/parent")
      .send({ childId: CHILD_ID, parentId: PARENT_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hierarchy.setOrganizationParent).toHaveBeenCalledWith(
      expect.anything(),
      { childId: CHILD_ID, parentId: PARENT_ID },
      expect.any(Date),
    );
  });

  it("moves a location to a different existing parent", async () => {
    hierarchy.setOrganizationParent.mockResolvedValue(undefined);

    const response = await request(testApp())
      .post("/api/organizations/hierarchy/parent")
      .send({ childId: OTHER_CHILD_ID, parentId: PARENT_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hierarchy.setOrganizationParent).toHaveBeenCalledWith(
      expect.anything(),
      { childId: OTHER_CHILD_ID, parentId: PARENT_ID },
      expect.any(Date),
    );
  });

  it("creates a parent and returns its id", async () => {
    hierarchy.createOrganizationParent.mockResolvedValue({ parentId: PARENT_ID });

    const payload = {
      name: "Adventure Zone",
      website: "https://adventure.example",
      phone: "555-0100",
      childIds: [CHILD_ID, OTHER_CHILD_ID],
    };
    const response = await request(testApp())
      .post("/api/organizations/hierarchy/create-parent")
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, parentId: PARENT_ID });
    expect(hierarchy.createOrganizationParent).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      expect.any(Date),
    );
  });

  it("ungroups a location", async () => {
    hierarchy.ungroupOrganization.mockResolvedValue(undefined);

    const response = await request(testApp())
      .post("/api/organizations/hierarchy/ungroup")
      .send({ childId: CHILD_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hierarchy.ungroupOrganization).toHaveBeenCalledWith(
      expect.anything(),
      { childId: CHILD_ID },
      expect.any(Date),
    );
  });

  it.each([
    ["/api/organizations/hierarchy/parent", { childId: "not-a-uuid", parentId: PARENT_ID }],
    ["/api/organizations/hierarchy/create-parent", { name: "Adventure Zone", childIds: ["not-a-uuid"] }],
    ["/api/organizations/hierarchy/ungroup", { childId: "not-a-uuid" }],
  ])("returns 400 for malformed hierarchy input at %s", async (path, payload) => {
    const response = await request(testApp()).post(path).send(payload);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      ok: false,
      error: expect.any(String),
    });
    expect(hierarchy.setOrganizationParent).not.toHaveBeenCalled();
    expect(hierarchy.createOrganizationParent).not.toHaveBeenCalled();
    expect(hierarchy.ungroupOrganization).not.toHaveBeenCalled();
  });

  it.each([
    ["parent", hierarchy.setOrganizationParent, { childId: CHILD_ID, parentId: PARENT_ID }],
    ["create-parent", hierarchy.createOrganizationParent, { name: "Adventure Zone", childIds: [CHILD_ID] }],
    ["ungroup", hierarchy.ungroupOrganization, { childId: CHILD_ID }],
  ])("returns a hierarchy conflict message from %s", async (endpoint, operation, payload) => {
    operation.mockRejectedValueOnce(
      new HierarchyConflictError("This profile cannot own locations."),
    );

    const response = await request(testApp())
      .post(`/api/organizations/hierarchy/${endpoint}`)
      .send(payload);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      error: "This profile cannot own locations.",
    });
  });

  it.each([
    ["parent", hierarchy.setOrganizationParent, { childId: CHILD_ID, parentId: PARENT_ID }],
    ["create-parent", hierarchy.createOrganizationParent, { name: "Adventure Zone", childIds: [CHILD_ID] }],
    ["ungroup", hierarchy.ungroupOrganization, { childId: CHILD_ID }],
  ])("returns a bounded 500 response from %s", async (endpoint, operation, payload) => {
    operation.mockRejectedValueOnce(
      new Error("database password and internal query must not leak"),
    );

    const response = await request(testApp())
      .post(`/api/organizations/hierarchy/${endpoint}`)
      .send(payload);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      ok: false,
      error: "Could not update organization hierarchy",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/password|query/i);
  });
});
