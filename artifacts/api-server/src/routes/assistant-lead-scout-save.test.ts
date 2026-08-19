import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAssistantLeadScoutRouter } from "./assistant-lead-scout";

const runId = "30000000-0000-4000-8000-000000000001";
const candidateId = "40000000-0000-4000-8000-000000000001";
const accepted = {
  name: "Silver Valley Days",
  city: "Kellogg",
  region: "ID",
  startsAt: "2026-09-11",
  endsAt: "2026-09-13",
  website: "https://example.org/silver-valley-days",
  contactName: "Jamie Organizer",
  contactEmail: "jamie@example.org",
  contactPhone: "208-555-0100",
};

function appWith(service: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).userId = "owner-1"; next(); });
  app.use(createAssistantLeadScoutRouter(service));
  return app;
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    createCrmDiscovery: vi.fn(), getRun: vi.fn(), getLatestRun: vi.fn(), startWeb: vi.fn(), stopWeb: vi.fn(), continueWeb: vi.fn(),
    deepenCandidate: vi.fn(), dismissCandidate: vi.fn(), saveCandidate: vi.fn(),
    ...overrides,
  };
}

describe("Lead Scout candidate save route", () => {
  it("requires accepted structured fields, first action, and follow-up date", async () => {
    const fake = service();
    await request(appWith(fake))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/save`)
      .send({ accepted, nextActionKind: "call", nextActionDueAt: "" })
      .expect(400);
    await request(appWith(fake))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/save`)
      .send({ accepted, nextActionKind: "fax", nextActionDueAt: "2026-08-24" })
      .expect(400);
    expect(fake.saveCandidate).not.toHaveBeenCalled();
  });

  it("passes only the confirmation payload and returns 201 for creation", async () => {
    const fake = service({
      saveCandidate: vi.fn(async () => ({ kind: "created", profileId: "profile-1", bookingId: "booking-1", run: { id: runId } })),
    });
    const response = await request(appWith(fake))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/save`)
      .send({ accepted, nextActionKind: "prepare_quote", nextActionDueAt: "2026-08-24" })
      .expect(201);

    expect(fake.saveCandidate).toHaveBeenCalledWith({
      actorId: "owner-1", runId, candidateId, accepted,
      nextActionKind: "prepare_quote", nextActionDueAt: "2026-08-24",
    });
    expect(response.body).toMatchObject({ kind: "created", profileId: "profile-1", bookingId: "booking-1" });
  });

  it("returns duplicate review data without claiming creation", async () => {
    const fake = service({
      saveCandidate: vi.fn(async () => ({
        kind: "duplicate",
        match: { status: "possible_match", organizationId: "org-existing", bookingId: "booking-existing", matchedName: "Silver Valley Days" },
        run: { id: runId },
      })),
    });
    const response = await request(appWith(fake))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/save`)
      .send({ accepted, nextActionKind: "email", nextActionDueAt: "2026-08-24" })
      .expect(200);

    expect(response.body.kind).toBe("duplicate");
    expect(response.body.match).toMatchObject({ status: "possible_match", organizationId: "org-existing" });
    expect(response.body.profileId).toBeUndefined();
  });

  it("returns 500 for persistence failures instead of misclassifying them as validation", async () => {
    const fake = service({
      saveCandidate: vi.fn(async () => { throw new Error("RESEARCH_PROSPECT_PROFILE_CREATE_FAILED"); }),
    });
    const response = await request(appWith(fake))
      .post(`/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/save`)
      .send({ accepted, nextActionKind: "call", nextActionDueAt: "2026-08-24" })
      .expect(500);

    expect(response.body.error).toMatch(/could not complete/i);
  });
});
