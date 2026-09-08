import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const contactId = "20000000-0000-4000-8000-000000000001";

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/follow-ups/today-query", () => ({
  TODAY_UPCOMING_EVENT_LIMIT: 5,
  getTodayDashboard: vi.fn(async () => ({
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
  LegAssignmentRepository: class {},
}));
vi.mock("@/features/leg-assignment/leg-assignment-service", () => ({
  LegAssignmentService: class {},
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
});
