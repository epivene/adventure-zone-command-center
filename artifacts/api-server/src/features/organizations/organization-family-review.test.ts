import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const repository = vi.hoisted(() => ({
  findDuplicates: vi.fn(),
  saveFamilyReview: vi.fn(),
  deleteFamilyReview: vi.fn(),
}));
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
vi.mock("@/features/organizations/organization-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/organizations/organization-repository")
  >();
  return {
    ...actual,
    DrizzleOrganizationRepository: class {
      findDuplicates = repository.findDuplicates;
      saveFamilyReview = repository.saveFamilyReview;
      deleteFamilyReview = repository.deleteFamilyReview;
    },
  };
});
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

import {
  discoverOrganizationFamilyCandidates,
  type DuplicateOrganizationGroup,
} from "./organization-repository";
import router from "../../routes/organizations";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";

const candidate: DuplicateOrganizationGroup = {
  normalizedName: "water lantern festival",
  city: "",
  region: "",
  classification: "location_candidate",
  groupKey: `organization-family:${FIRST_ID}|${SECOND_ID}`,
  candidateIds: [FIRST_ID, SECOND_ID],
  evidence: [
    { family: "website", label: "website domains agree" },
    { family: "location", label: "locations differ" },
  ],
  organizations: [
    {
      id: FIRST_ID,
      name: "Water Lantern Festival - Denver, CO",
      city: "Denver",
      region: "CO",
      contactCount: 0,
      bookingCount: 0,
      primaryContactName: null,
      lastResort: false,
      lastResortReason: null,
      lastResortChangedAt: null,
      parent: null,
      locationCount: 0,
    },
    {
      id: SECOND_ID,
      name: "Water Lantern Festival - Austin, TX",
      city: "Austin",
      region: "TX",
      contactCount: 0,
      bookingCount: 0,
      primaryContactName: null,
      lastResort: false,
      lastResortReason: null,
      lastResortChangedAt: null,
      parent: null,
      locationCount: 0,
    },
  ],
};

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

describe("organization family review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.findDuplicates.mockResolvedValue([candidate]);
    repository.saveFamilyReview.mockResolvedValue(undefined);
    repository.deleteFamilyReview.mockResolvedValue(undefined);
    hierarchy.setOrganizationParent.mockResolvedValue(undefined);
    hierarchy.createOrganizationParent.mockResolvedValue({ parentId: PARENT_ID });
  });

  it("labels a strong cross-city website family as a location candidate", () => {
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: FIRST_ID,
        name: "Water Lantern Festival - Denver, CO",
        website: "https://waterlanternfestival.com/denver",
        address1: "100 Lake St",
        city: "Denver",
        region: "CO",
        postalCode: "80202",
      },
      {
        id: SECOND_ID,
        name: "Water Lantern Festival - Austin, TX",
        website: "https://www.waterlanternfestival.com/austin",
        address1: "200 River Rd",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
      },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        classification: "location_candidate",
        candidateIds: [FIRST_ID, SECOND_ID],
        evidence: expect.arrayContaining([
          { family: "website", label: "website domains agree" },
          { family: "location", label: "locations differ" },
        ]),
      }),
    ]);
  });

  it("returns 409 when the submitted candidate IDs are stale", async () => {
    repository.findDuplicates.mockResolvedValue([]);

    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send({ action: "not_related", candidateIds: [FIRST_ID, SECOND_ID] });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/changed|refresh/i);
    expect(repository.saveFamilyReview).not.toHaveBeenCalled();
  });

  it("creates a parent through the transactional hierarchy service before clearing the proposal", async () => {
    const payload = {
      action: "make_locations",
      candidateIds: [SECOND_ID, FIRST_ID],
      parent: {
        kind: "new",
        name: "Water Lantern Festival",
        website: "waterlanternfestival.com",
      },
    };

    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send(payload);

    expect(response.status).toBe(200);
    expect(hierarchy.createOrganizationParent).toHaveBeenCalledWith(
      expect.anything(),
      {
        name: "Water Lantern Festival",
        website: "waterlanternfestival.com",
        childIds: [FIRST_ID, SECOND_ID],
      },
      expect.any(Date),
    );
    expect(repository.deleteFamilyReview).toHaveBeenCalledWith(candidate.groupKey);
    expect(hierarchy.createOrganizationParent.mock.invocationCallOrder[0]).toBeLessThan(
      repository.deleteFamilyReview.mock.invocationCallOrder[0],
    );
  });

  it("attaches every candidate to an existing parent through the hierarchy service", async () => {
    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send({
        action: "make_locations",
        candidateIds: [FIRST_ID, SECOND_ID],
        parent: { kind: "existing", parentId: PARENT_ID },
      });

    expect(response.status).toBe(200);
    expect(hierarchy.setOrganizationParent).toHaveBeenCalledTimes(2);
    expect(hierarchy.setOrganizationParent).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { childId: FIRST_ID, parentId: PARENT_ID },
      expect.any(Date),
    );
    expect(hierarchy.setOrganizationParent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { childId: SECOND_ID, parentId: PARENT_ID },
      expect.any(Date),
    );
  });

  it("stores a stable not-related decision so the group does not reappear", async () => {
    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send({ action: "not_related", candidateIds: [SECOND_ID, FIRST_ID] });

    expect(response.status).toBe(200);
    expect(repository.saveFamilyReview).toHaveBeenCalledWith({
      groupKey: candidate.groupKey,
      candidateIds: [FIRST_ID, SECOND_ID],
      evidence: candidate.evidence,
      status: "not_related",
    });
    expect(repository.deleteFamilyReview).not.toHaveBeenCalled();
  });
});
