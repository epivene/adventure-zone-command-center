import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const contactId = "20000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({
  dashboard: null as any,
  savedDecisions: new Map<string, any>(),
  suggestedIds: [] as string[],
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/follow-ups/today-query", () => ({
  TODAY_UPCOMING_EVENT_LIMIT: 5,
  getTodayDashboard: vi.fn(async () => state.dashboard ?? ({
    followUps: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        contactId,
        kind: "Review: Festival",
      },
    ],
    nextCall: null,
    needsFollowUpPlan: [],
  })),
  enrichTodayDashboardOperations: vi.fn(async (dashboard) => dashboard),
}));
vi.mock("@/features/follow-ups/today-season-reset", () => ({
  applyTodaySeasonResetFromDb: vi.fn(async (_db, dashboard) => dashboard),
}));
vi.mock("@/features/follow-ups/today-copilot", () => ({
  withBookingCopilotMetadata: vi.fn((dashboard) => dashboard),
}));
vi.mock("@/features/follow-ups/today-upcoming-events", () => ({
  listTodayUpcomingEvents: vi.fn(async () => []),
}));
vi.mock("@/features/bookings/booking-operations-summary", () => ({
  createBookingOperationsSummaryProvider: vi.fn(() => ({})),
}));
vi.mock("@/features/contact-phones/contact-phone-repository", () => ({
  createContactPhoneRepository: vi.fn(() => ({
    listForContact: vi.fn(async () => [
      {
        id: "50000000-0000-4000-8000-000000000001",
        number: "307-555-0100",
        extension: null,
        type: "office",
        primary: true,
        doNotCallAt: null,
      },
    ]),
  })),
}));
vi.mock("@/features/follow-ups/today-next-step", () => ({
  filterClearedTodayNextSteps: vi.fn(async (_db, items) => items),
  clearTodayNextSteps: vi.fn(),
  parseTodayNextStepBookingIds: vi.fn(),
  reopenTodayNextSteps: vi.fn(),
  snoozeTodayNextSteps: vi.fn(),
}));
vi.mock("@/features/today/master-work-queue-repository", () => ({
  loadMasterTodayQueue: vi.fn(async () => ({
    active: [],
    completedToday: [],
    needsAttention: [],
  })),
}));
vi.mock("@/features/trips/trip-repository", () => ({
  listTripsInWindow: vi.fn(async () => []),
}));
vi.mock("@/features/routes/travel-leg-repository", () => ({
  DrizzleTravelLegRepository: class {
    async listTravelLegs() {
      return [];
    }
  },
}));
vi.mock("@/features/leg-assignment/leg-assignment-repository", () => ({
  LegAssignmentRepository: class {
    loadPersistedDecision(bookingId: string) {
      return Promise.resolve(state.savedDecisions.get(bookingId) ?? null);
    }
  },
}));
vi.mock("@/features/leg-assignment/leg-assignment-service", () => ({
  LegAssignmentService: class {
    async suggest(bookingId: string) {
      state.suggestedIds.push(bookingId);
      const decision = {
        bookingId,
        assignedLegId: null,
        suggestedLegId: "60000000-0000-4000-8000-000000000001",
        source: "route_score",
        explanation: "Balanced workload and route fit.",
        warning: null,
        confidence: "medium",
      };
      state.savedDecisions.set(bookingId, decision);
      return decision;
    }
  },
}));
vi.mock("@/features/leg-assignment/drive-time-estimator", () => ({
  RouteDriveTimeEstimator: class {},
}));
vi.mock("@/features/assistant/scout-alert-repository", () => ({
  ScoutAlertRepository: class {
    async listVisible() {
      return [];
    }
  },
}));
vi.mock("@/features/office/office-owner-attention", () => ({
  emptyOfficeCoordinatorAttention: vi.fn(() => ({
    needsHelpCount: 0,
    needsHelpTasks: [],
    submittedDraftCount: 0,
    submittedDrafts: [],
  })),
  loadOfficeCoordinatorAttention: vi.fn(async () => ({
    needsHelpCount: 0,
    needsHelpTasks: [],
    submittedDraftCount: 0,
    submittedDrafts: [],
  })),
}));

import todayRouter from "./today";

beforeEach(() => {
  state.dashboard = null;
  state.savedDecisions.clear();
  state.suggestedIds.length = 0;
});

describe("Today callable phone enrichment", () => {
  it("loads a phone for a profile-linked task whose kind is a descriptive label", async () => {
    const app = express();
    app.use("/api", todayRouter);

    const response = await request(app).get("/api/today");

    expect(response.status).toBe(200);
    expect(response.body.followUps[0].callPhone).toEqual({
      id: "50000000-0000-4000-8000-000000000001",
      number: "307-555-0100",
      extension: null,
      type: "office",
    });
  });

  it("loads missing suggestions for every open lead stage but preserves existing manual assignments", async () => {
    const newLeadId = "30000000-0000-4000-8000-000000000001";
    const researchedLeadId = "30000000-0000-4000-8000-000000000002";
    const assignedLeadId = "30000000-0000-4000-8000-000000000003";
    const manualDecision = {
      bookingId: assignedLeadId,
      assignedLegId: "60000000-0000-4000-8000-000000000002",
      suggestedLegId: "60000000-0000-4000-8000-000000000002",
      source: "manual",
      explanation: "Assigned manually",
      warning: null,
      confidence: "high",
    };
    state.savedDecisions.set(assignedLeadId, manualDecision);
    state.dashboard = {
      followUps: [],
      nextCall: null,
      needsFollowUpPlan: [
        { id: newLeadId, status: "new_lead", contactId: null },
        { id: researchedLeadId, status: "researching", contactId: null },
        { id: assignedLeadId, status: "contacted", contactId: null },
      ],
    };

    const app = express();
    app.use("/api", todayRouter);
    const response = await request(app).get("/api/today");

    expect(response.status).toBe(200);
    expect(state.suggestedIds).toEqual([newLeadId, researchedLeadId]);
    expect(response.body.needsFollowUpPlan.map((item: any) => item.legAssignment)).toEqual([
      expect.objectContaining({ suggestedLegId: "60000000-0000-4000-8000-000000000001" }),
      expect.objectContaining({ suggestedLegId: "60000000-0000-4000-8000-000000000001" }),
      manualDecision,
    ]);
  });
});
