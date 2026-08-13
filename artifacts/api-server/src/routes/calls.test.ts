import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/caller-finder/caller-finder-service", () => ({
  CallerFinderService: class {
    find = find;
  },
}));
vi.mock("@/features/calls/call-repository", () => ({
  DrizzleCallRepository: class {},
}));
vi.mock("@/features/calls/call-service", () => ({
  CallService: class {},
}));
vi.mock("@/features/calls/call-workspace-context", () => ({
  DrizzleCallWorkspaceContextRepository: class {},
  activityTimelineParent: vi.fn(),
}));
vi.mock("@/features/activities/activity-service", () => ({
  ActivityService: class {},
}));
vi.mock("@/features/activities/activity-repository", () => ({
  DrizzleActivityRepository: class {},
}));
vi.mock("@/features/calls/call-workspace-query", () => ({
  loadCallWorkspace: vi.fn(),
}));
vi.mock("@/features/bookings/booking-operations-summary", () => ({
  createBookingOperationsSummaryProvider: vi.fn(),
}));
vi.mock("@/features/contact-phones/contact-phone-repository", () => ({
  createContactPhoneRepository: vi.fn(),
}));

import callsRouter from "./calls";

function callsApp() {
  const app = express();
  app.use(callsRouter);
  return app;
}

describe("caller finder route", () => {
  const app = callsApp();

  beforeEach(() => find.mockReset());

  it("returns only the bounded finder result", async () => {
    find.mockResolvedValue({
      exact: { kind: "none" },
      suggestions: [{
        contactId: "11111111-1111-4111-8111-111111111111",
        name: "Avery Lee",
        organizationName: "North Star Events",
        city: "Fargo",
        region: "ND",
        bookingStatus: "interested",
        routeLegName: "North",
        lastContactedAt: null,
        reasons: ["Name"],
        score: 700,
      }],
      canCreate: true,
    });

    const response = await request(app)
      .get("/calls/caller-finder")
      .query({ phone: "701-555-0199", q: "Avery" })
      .expect(200);

    expect(find).toHaveBeenCalledWith({
      phone: "701-555-0199",
      query: "Avery",
    });
    expect(response.body).toEqual({
      exact: { kind: "none" },
      suggestions: [expect.objectContaining({
        contactId: "11111111-1111-4111-8111-111111111111",
        reasons: ["Name"],
      })],
      canCreate: true,
    });
  });

  it("rejects overlong phone and query values before searching", async () => {
    await request(app)
      .get("/calls/caller-finder")
      .query({ phone: "1".repeat(41), q: "x".repeat(121) })
      .expect(400);

    expect(find).not.toHaveBeenCalled();
  });
});

describe("assisted calling configuration route", () => {
  const app = callsApp();
  const originalEnabled = process.env.ASSISTED_CALLING_ENABLED;
  const originalLauncher = process.env.VOICEMAIL_LAUNCH_URL;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.ASSISTED_CALLING_ENABLED;
    else process.env.ASSISTED_CALLING_ENABLED = originalEnabled;
    if (originalLauncher === undefined) delete process.env.VOICEMAIL_LAUNCH_URL;
    else process.env.VOICEMAIL_LAUNCH_URL = originalLauncher;
  });

  it("returns only the enabled flag and configured voicemail launch target", async () => {
    process.env.ASSISTED_CALLING_ENABLED = "true";
    process.env.VOICEMAIL_LAUNCH_URL = "https://launcher.example.test/voicemail";

    const response = await request(app).get("/calls/config").expect(200);

    expect(response.body).toEqual({
      assistedCallingEnabled: true,
      voicemailLauncherUrl: "https://launcher.example.test/voicemail",
    });
  });

  it("uses safe disabled defaults without implying voicemail delivery", async () => {
    delete process.env.ASSISTED_CALLING_ENABLED;
    delete process.env.VOICEMAIL_LAUNCH_URL;

    const response = await request(app).get("/calls/config").expect(200);

    expect(response.body).toEqual({
      assistedCallingEnabled: false,
      voicemailLauncherUrl: null,
    });
  });
});
