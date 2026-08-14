import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PgDialect } from "drizzle-orm/pg-core";

const repository = vi.hoisted(() => ({
  findDuplicates: vi.fn(),
  saveFamilyReview: vi.fn(),
  deleteFamilyReview: vi.fn(),
  reviewOrganizationFamily: vi.fn(),
}));
const hierarchy = vi.hoisted(() => ({
  setOrganizationParent: vi.fn(),
  setOrganizationParents: vi.fn(),
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
    reviewOrganizationFamily: repository.reviewOrganizationFamily,
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
  discoverOrganizationFamilyCandidatesFromDatabase,
  partitionOrganizationReviewGroups,
  type DuplicateOrganizationGroup,
} from "./organization-repository";
import { HierarchyConflictError } from "./organization-hierarchy";
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
      matchedLocation: null,
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
      matchedLocation: null,
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
    repository.reviewOrganizationFamily.mockResolvedValue(undefined);
    hierarchy.setOrganizationParent.mockResolvedValue(undefined);
    hierarchy.setOrganizationParents.mockResolvedValue(undefined);
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

  it("classifies exact-name records in distinct complete locations as ambiguous without a website", () => {
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: FIRST_ID,
        name: "Water Lantern Festival",
        website: null,
        address1: "100 Lake St",
        city: "Denver",
        region: "CO",
      },
      {
        id: SECOND_ID,
        name: "Water Lantern Festival",
        website: null,
        address1: "200 River Rd",
        city: "Austin",
        region: "TX",
      },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        classification: "ambiguous_location_candidate",
        candidateIds: [FIRST_ID, SECOND_ID],
        evidence: expect.arrayContaining([
          { family: "name", label: "exact organization names agree" },
          { family: "location", label: "locations differ" },
        ]),
      }),
    ]);
  });


  it("warns on the whole exact-name bucket even when every member shares a strong website", () => {
    const thirdId = "44444444-4444-4444-8444-444444444444";
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: FIRST_ID,
        name: "Water Lantern Festival",
        website: "https://waterlanternfestival.example/denver",
        address1: "100 Lake St",
        city: "Denver",
        region: "CO",
      },
      {
        id: SECOND_ID,
        name: "Water Lantern Festival",
        website: "https://waterlanternfestival.example/austin",
        address1: "200 River Rd",
        city: "Austin",
        region: "TX",
      },
      {
        id: thirdId,
        name: "Water Lantern Festival",
        website: "https://waterlanternfestival.example/boston",
        address1: "300 Harbor Rd",
        city: "Boston",
        region: "MA",
      },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        classification: "ambiguous_location_candidate",
        candidateIds: [FIRST_ID, SECOND_ID, thirdId],
        evidence: expect.arrayContaining([
          { family: "name", label: "exact organization names agree" },
          { family: "website", label: "website domains agree" },
          { family: "location", label: "locations differ" },
        ]),
      }),
    ]);
  });

  it("returns one ambiguous review when a strong subset overlaps a larger exact-name location group", () => {
    const thirdId = "44444444-4444-4444-8444-444444444444";
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: FIRST_ID,
        name: "Water Lantern Festival",
        website: "https://lantern.example/denver",
        address1: "100 Lake St",
        city: "Denver",
        region: "CO",
      },
      {
        id: SECOND_ID,
        name: "Water Lantern Festival",
        website: "https://lantern.example/austin",
        address1: "200 River Rd",
        city: "Austin",
        region: "TX",
      },
      {
        id: thirdId,
        name: "Water Lantern Festival",
        website: null,
        address1: "300 Harbor Rd",
        city: "Boston",
        region: "MA",
      },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        classification: "ambiguous_location_candidate",
        candidateIds: [FIRST_ID, SECOND_ID, thirdId],
      }),
    ]);
  });

  it.each([
    {
      label: "repeated complete locations",
      records: [
        { id: FIRST_ID, name: "Water Lantern Festival", address1: "100 Lake St", city: "Denver", region: "CO" },
        { id: SECOND_ID, name: "Water Lantern Festival", address1: "200 Lake St", city: "Denver", region: "CO" },
        { id: "44444444-4444-4444-8444-444444444444", name: "Water Lantern Festival", address1: "300 River Rd", city: "Austin", region: "TX" },
      ],
    },
    {
      label: "an incomplete member",
      records: [
        { id: FIRST_ID, name: "Water Lantern Festival", address1: "100 Lake St", city: "Denver", region: "CO" },
        { id: SECOND_ID, name: "Water Lantern Festival", address1: "200 River Rd", city: "Austin", region: "TX" },
        { id: "44444444-4444-4444-8444-444444444444", name: "Water Lantern Festival", address1: "300 Unknown Rd", city: "", region: "" },
      ],
    },
  ])("protects the whole exact-name bucket with $label", ({ records }) => {
    const groups = discoverOrganizationFamilyCandidates(records);
    expect(groups).toEqual([
      expect.objectContaining({
        classification: "ambiguous_location_candidate",
        candidateIds: [
          FIRST_ID,
          SECOND_ID,
          "44444444-4444-4444-8444-444444444444",
        ],
      }),
    ]);
  });

  it("keeps a same-address cross-city exact-name bucket in manual review", () => {
    const groups = discoverOrganizationFamilyCandidates([
      {
        id: FIRST_ID,
        name: "Water Lantern Festival",
        address1: "100 Lake St",
        city: "Denver",
        region: "CO",
      },
      {
        id: SECOND_ID,
        name: "Water Lantern Festival",
        address1: "100 Lake St",
        city: "Austin",
        region: "TX",
      },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        classification: "ambiguous_location_candidate",
        candidateIds: [FIRST_ID, SECOND_ID],
        evidence: expect.arrayContaining([
          {
            family: "address",
            label: "street addresses repeat across different locations",
          },
        ]),
      }),
    ]);
  });

  it("does not classify exact names when a location is blank or the complete location is the same", () => {
    expect(discoverOrganizationFamilyCandidates([
      { id: FIRST_ID, name: "Lantern Nights", city: "", region: "CO" },
      { id: SECOND_ID, name: "Lantern Nights", city: "Austin", region: "TX" },
    ])).toEqual([]);

    expect(discoverOrganizationFamilyCandidates([
      { id: FIRST_ID, name: "Lantern Nights", city: "Austin", region: "TX", address1: "100 Lake St" },
      { id: SECOND_ID, name: "Lantern Nights", city: "Austin", region: "TX", address1: "200 River Rd" },
    ])).toEqual([]);
  });

  it("excludes an ordinary duplicate group when any member overlaps a family", () => {
    const { organizations: _organizations, ...family } = candidate;
    const groups = partitionOrganizationReviewGroups(
      [{
        normalized_name: "water lantern festival",
        normalized_city: "austin",
        normalized_region: "tx",
        ids: [FIRST_ID, "44444444-4444-4444-8444-444444444444"],
      }],
      [family],
      [],
    );

    expect(groups).toEqual([family]);
  });

  it("hydrates a credible shared-contact ACT connection through the production query", async () => {
    const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const contactSourceId = "act-contact-shared";
    const stagedRelationships = [
      { runId, streamType: "company_contact", sourceId: "act-company-lantern", targetSourceId: contactSourceId },
      { runId, streamType: "company_contact", sourceId: "act-company-glow", targetSourceId: contactSourceId },
      { runId, streamType: "opportunity_company", sourceId: "act-opportunity-ignored", targetSourceId: "act-company-lantern" },
    ];
    const stagedLinks = [
      {
        migrationRunId: runId,
        entityType: "organization",
        sourceEntityType: "company",
        entityId: FIRST_ID,
        actRecordId: "act-company-lantern",
      },
      {
        migrationRunId: runId,
        entityType: "organization",
        sourceEntityType: "company",
        entityId: SECOND_ID,
        actRecordId: "act-company-glow",
      },
    ];
    let renderedSql = "";
    const database = {
      execute(statement: Parameters<PgDialect["sqlToQuery"]>[0]) {
        const rendered = new PgDialect().sqlToQuery(statement);
        renderedSql = rendered.sql.toLowerCase().replace(/\s+/g, " ");
        const rows: Array<{
          sourceOrganizationId: string;
          targetOrganizationId: string;
          provenance: "act_relationship";
        }> = [];
        for (let leftIndex = 0; leftIndex < stagedRelationships.length; leftIndex += 1) {
          const left = stagedRelationships[leftIndex]!;
          if (left.streamType !== "company_contact") continue;
          for (let rightIndex = leftIndex + 1; rightIndex < stagedRelationships.length; rightIndex += 1) {
            const right = stagedRelationships[rightIndex]!;
            if (
              right.streamType !== "company_contact" ||
              right.runId !== left.runId ||
              right.targetSourceId !== left.targetSourceId ||
              right.sourceId === left.sourceId
            ) continue;
            const source = stagedLinks.find(
              (link) =>
                link.migrationRunId === left.runId &&
                link.sourceEntityType === "company" &&
                link.actRecordId === left.sourceId,
            );
            const target = stagedLinks.find(
              (link) =>
                link.migrationRunId === right.runId &&
                link.sourceEntityType === "company" &&
                link.actRecordId === right.sourceId,
            );
            if (source && target) {
              rows.push({
                sourceOrganizationId: source.entityId,
                targetOrganizationId: target.entityId,
                provenance: "act_relationship",
              });
            }
          }
        }
        return Promise.resolve({ rows });
      },
    };

    const groups = await discoverOrganizationFamilyCandidatesFromDatabase(
      database as never,
      [
        {
          id: FIRST_ID,
          name: "Lantern Nights",
          website: "https://shared.example/austin",
          address1: "100 Lake St",
          city: "Austin",
          region: "TX",
        },
        {
          id: SECOND_ID,
          name: "Glow Across America",
          website: "https://shared.example/denver",
          address1: "200 River Rd",
          city: "Denver",
          region: "CO",
        },
      ],
    );

    expect(renderedSql).toContain("left_relationship.stream_type = 'company_contact'");
    expect(renderedSql).toContain("right_relationship.stream_type = 'company_contact'");
    expect(renderedSql).toContain(
      "right_relationship.target_source_id = left_relationship.target_source_id",
    );
    expect(groups).toEqual([
      expect.objectContaining({
        classification: "location_candidate",
        candidateIds: [FIRST_ID, SECOND_ID],
        evidence: expect.arrayContaining([
          {
            family: "act_relationship",
            label: "ACT organization relationships connect the records",
          },
        ]),
      }),
    ]);
  });

  it("keeps a not-related family out of both review classifications", () => {
    const { organizations: _organizations, ...family } = candidate;
    const groups = partitionOrganizationReviewGroups(
      [{
        normalized_name: "water lantern festival",
        normalized_city: "austin",
        normalized_region: "tx",
        ids: [FIRST_ID, SECOND_ID],
      }],
      [family],
      [{
        groupKey: candidate.groupKey!,
        status: "not_related",
      }],
    );

    expect(groups).toEqual([]);
  });

  it("returns 409 when the atomic family review reports stale candidates", async () => {
    repository.reviewOrganizationFamily.mockRejectedValue(
      new HierarchyConflictError(
        "This organization family changed. Refresh the review list and try again.",
      ),
    );

    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send({ action: "not_related", candidateIds: [FIRST_ID, SECOND_ID] });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/changed|refresh/i);
  });

  it("submits create-parent decisions to the atomic family review service", async () => {
    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send({
        action: "make_locations",
        candidateIds: [SECOND_ID, FIRST_ID],
        parent: {
          kind: "new",
          name: "Water Lantern Festival",
          website: "waterlanternfestival.com",
        },
      });

    expect(response.status).toBe(200);
    expect(repository.reviewOrganizationFamily).toHaveBeenCalledWith(
      expect.anything(),
      {
        action: "make_locations",
        candidateIds: [FIRST_ID, SECOND_ID],
        parent: {
          kind: "new",
          name: "Water Lantern Festival",
          website: "waterlanternfestival.com",
        },
      },
      expect.any(Date),
    );
  });

  it("submits existing-parent decisions to the atomic family review service", async () => {
    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send({
        action: "make_locations",
        candidateIds: [FIRST_ID, SECOND_ID],
        parent: { kind: "existing", parentId: PARENT_ID },
      });

    expect(response.status).toBe(200);
    expect(repository.reviewOrganizationFamily).toHaveBeenCalledWith(
      expect.anything(),
      {
        action: "make_locations",
        candidateIds: [FIRST_ID, SECOND_ID],
        parent: { kind: "existing", parentId: PARENT_ID },
      },
      expect.any(Date),
    );
  });

  it("submits not-related decisions to the same atomic family review service", async () => {
    const response = await request(testApp())
      .post("/api/organizations/family-review")
      .send({ action: "not_related", candidateIds: [SECOND_ID, FIRST_ID] });

    expect(response.status).toBe(200);
    expect(repository.reviewOrganizationFamily).toHaveBeenCalledWith(
      expect.anything(),
      {
        action: "not_related",
        candidateIds: [FIRST_ID, SECOND_ID],
      },
      expect.any(Date),
    );
  });
});
