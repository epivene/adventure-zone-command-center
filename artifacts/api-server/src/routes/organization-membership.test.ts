import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const parentId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const otherParentId = "33333333-3333-4333-8333-333333333333";

const searchChildren = vi.hoisted(() => vi.fn());
const searchParents = vi.hoisted(() => vi.fn());
const setMembership = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/organizations/organization-membership-query", () => ({
  searchEligibleOrganizationChildren: searchChildren,
  searchEligibleOrganizationParents: searchParents,
}));
vi.mock("@/features/organizations/organization-membership", () => ({
  setOrganizationMembership: setMembership,
}));

import membershipRouter from "./organization-membership";

describe("organization membership routes", () => {
  const app = express();
  app.use(express.json());
  app.use(membershipRouter);

  beforeEach(() => {
    searchChildren.mockReset();
    searchParents.mockReset();
    setMembership.mockReset();
  });

  it("returns add-existing candidates with current-parent context", async () => {
    searchChildren.mockResolvedValue([{ id: childId, name: "Denver Lantern", city: "Denver", region: "CO", currentParent: { id: otherParentId, name: "Other Group", city: null, region: null } }]);
    const response = await request(app).get(`/organizations/${parentId}/membership-candidates?q=Denver`).expect(200);
    expect(searchChildren).toHaveBeenCalledWith({}, "Denver", parentId);
    expect(response.body.profiles[0].currentParent.name).toBe("Other Group");
  });

  it("returns valid parent organizations for a child", async () => {
    searchParents.mockResolvedValue([{ id: parentId, name: "Water Lantern Festival", city: null, region: null }]);
    const response = await request(app).get(`/event-profiles/${childId}/organization-candidates?q=water`).expect(200);
    expect(searchParents).toHaveBeenCalledWith({}, "water", childId);
    expect(response.body.organizations[0].id).toBe(parentId);
  });

  it("attaches or changes organization through the membership service", async () => {
    setMembership.mockResolvedValue({ childId, parentOrganizationId: parentId, previousParentOrganizationId: otherParentId });
    const response = await request(app).put(`/event-profiles/${childId}/organization`).send({ organizationId: parentId }).expect(200);
    expect(setMembership).toHaveBeenCalledWith({}, { childId, parentOrganizationId: parentId }, expect.any(Date));
    expect(response.body.membership.previousParentOrganizationId).toBe(otherParentId);
  });

  it("removes organization membership without deleting the profile", async () => {
    setMembership.mockResolvedValue({ childId, parentOrganizationId: null, previousParentOrganizationId: parentId });
    const response = await request(app).delete(`/event-profiles/${childId}/organization`).expect(200);
    expect(setMembership).toHaveBeenCalledWith({}, { childId, parentOrganizationId: null }, expect.any(Date));
    expect(response.body.membership.parentOrganizationId).toBeNull();
  });

  it("returns 409 for hierarchy conflicts", async () => {
    const error = Object.assign(new Error("That organization is already a location/event of another organization."), { name: "OrganizationConflictError" });
    setMembership.mockRejectedValue(error);
    await request(app).put(`/event-profiles/${childId}/organization`).send({ organizationId: parentId }).expect(409);
  });

  it("rejects invalid ids and overlong search queries", async () => {
    await request(app).put(`/event-profiles/not-a-uuid/organization`).send({ organizationId: parentId }).expect(400);
    await request(app).get(`/organizations/${parentId}/membership-candidates?q=${"x".repeat(201)}`).expect(400);
  });
});
