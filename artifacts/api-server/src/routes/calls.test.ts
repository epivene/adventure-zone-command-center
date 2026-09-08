import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { find, complete } = vi.hoisted(() => ({ find: vi.fn(), complete: vi.fn() }));

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
  CallService: class { complete = complete; },
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

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import callsRouter from "./calls";

const originalSecret = process.env.SESSION_SECRET;
let authorization = "";

beforeEach(() => {
  process.env.ASSISTED_CALLING_ENABLED = "true";
});

beforeAll(() => {
  process.env.SESSION_SECRET = "task-10-http-date-secret";
  const issued = issueToken();
  if (!issued) throw new Error("Could not issue owner test token");
  authorization = `Bearer ${issued.token}`;
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

function callsApp() {
  const app = express();
  app.use(express.json());
  app.post("/calls/complete", requireOwnerMiddleware);
  app.use(callsRouter);
  return app;
}

const completeBody = {
  requestKey: "70000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactId: "20000000-0000-4000-8000-000000000001",
  bookingId: "30000000-0000-4000-8000-000000000001",
  followUpId: "60000000-0000-4000-8000-000000000001",
  note: "Discussed the event.",
  disposition: "follow_up_needed",
  resultingBookingStatus: null,
  startedAt: "2026-08-13T16:00:00.000Z",
  endedAt: "2026-08-13T16:05:00.000Z",
  nextAction: { kind: "call", dueAt: "2026-08-14T16:00:00.000Z" },
  lastResortReason: null,
  lastResortConfirmed: false,
  approvedContactUpdates: null,
  approvedBookingUpdates: {
    startsAt: "2026-09-20T15:00:00.000Z",
    endsAt: "2026-09-20T18:00:00.000Z",
  },
  direction: "outgoing",
  method: "office_call",
  phoneId: "50000000-0000-4000-8000-000000000001",
  scriptKind: "follow_up",
  doNotCallConfirmed: false,
  doNotCallReason: null,
  doNotCallPhoneId: null,
  entryMode: "desktop",
};

describe("call completion HTTP dates", () => {
  const app = callsApp();

  beforeEach(() => complete.mockReset().mockResolvedValue({ ok: true, value: {} }));

  it("coerces JSON ISO dates before calling the Date-based service contract", async () => {
    await request(app).post("/calls/complete").set("Authorization", authorization).send(completeBody).expect(200);

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(completeBody.startedAt),
      endedAt: new Date(completeBody.endedAt),
      nextAction: expect.objectContaining({ dueAt: new Date(completeBody.nextAction.dueAt) }),
      approvedBookingUpdates: expect.objectContaining({
        startsAt: new Date(completeBody.approvedBookingUpdates.startsAt),
        endsAt: new Date(completeBody.approvedBookingUpdates.endsAt),
      }),
    }));
  });

  it("explains when a future next action is required", async () => {
    complete.mockResolvedValueOnce({ ok: false, error: { code: "NEXT_ACTION_REQUIRED" } });

    const response = await request(app)
      .post("/calls/complete")
      .set("Authorization", authorization)
      .send({ ...completeBody, nextAction: null })
      .expect(400);

    expect(response.body).toEqual({
      ok: false,
      error: "Choose a next action and a future date before saving this call.",
    });
  });

  it("rejects invalid JSON dates before calling the service", async () => {
    await request(app).post("/calls/complete").set("Authorization", authorization).send({
      ...completeBody,
      startedAt: "not-a-date",
    }).expect(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects mobile-only metadata from a desktop entry", async () => {
    await request(app).post("/calls/complete").set("Authorization", authorization).send({
      ...completeBody,
      method: "mobile_log",
    }).expect(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("requires canonical incoming mobile method and script metadata", async () => {
    await request(app).post("/calls/complete").set("Authorization", authorization).send({
      ...completeBody,
      entryMode: "mobile",
      direction: "incoming",
      method: "mobile_log",
      scriptKind: "follow_up",
    }).expect(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("requires Do Not Call confirmation to name the selected phone", async () => {
    await request(app).post("/calls/complete").set("Authorization", authorization).send({
      ...completeBody,
      disposition: "do_not_call",
      nextAction: null,
      doNotCallConfirmed: true,
      doNotCallReason: "Requested",
      doNotCallPhoneId: "50000000-0000-4000-8000-000000000002",
    }).expect(400);
    expect(complete).not.toHaveBeenCalled();
  });
});

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

  it("does not expose assisted endpoints while the server flag is explicitly off", async () => {
    process.env.ASSISTED_CALLING_ENABLED = "false";
    await request(app).get("/calls/caller-finder").expect(404);
    expect(find).not.toHaveBeenCalled();
  });
});

describe("assisted calling configuration route", () => {
  const app = callsApp();
  const originalEnabled = process.env.ASSISTED_CALLING_ENABLED;
  const originalLauncher = process.env.VOICEMAIL_LAUNCH_URL;
  const twilioEnvironmentNames = [
    "TWILIO_VOICE_ENABLED",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_TWIML_APP_SID",
    "TWILIO_VERIFIED_CALLER_ID",
    "TWILIO_WEBHOOK_BASE_URL",
  ] as const;
  const originalTwilioEnvironment = Object.fromEntries(
    twilioEnvironmentNames.map((name) => [name, process.env[name]]),
  );

  function enableTwilioCalling(): void {
    Object.assign(process.env, {
      TWILIO_VOICE_ENABLED: "true",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_API_KEY_SID: "SK123",
      TWILIO_API_KEY_SECRET: "secret",
      TWILIO_AUTH_TOKEN: "auth",
      TWILIO_TWIML_APP_SID: "AP123",
      TWILIO_VERIFIED_CALLER_ID: "+15551234567",
      TWILIO_WEBHOOK_BASE_URL: "https://calls.example.test",
    });
  }

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.ASSISTED_CALLING_ENABLED;
    else process.env.ASSISTED_CALLING_ENABLED = originalEnabled;
    if (originalLauncher === undefined) delete process.env.VOICEMAIL_LAUNCH_URL;
    else process.env.VOICEMAIL_LAUNCH_URL = originalLauncher;
    for (const name of twilioEnvironmentNames) {
      const value = originalTwilioEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("returns the enabled computer-calling capability with existing config fields", async () => {
    process.env.ASSISTED_CALLING_ENABLED = "true";
    process.env.VOICEMAIL_LAUNCH_URL = "https://launcher.example.test/voicemail";
    enableTwilioCalling();

    const response = await request(app).get("/calls/config").expect(200);

    expect(response.body).toEqual({
      assistedCallingEnabled: true,
      voicemailLauncherUrl: "https://launcher.example.test/voicemail",
      computerCalling: {
        enabled: true,
        reason: "available",
        callerIdDisplay: "+15551234567",
      },
    });
  });

  it("keeps computer calling disabled when the assisted-calling product gate is off", async () => {
    process.env.ASSISTED_CALLING_ENABLED = "false";
    enableTwilioCalling();

    const response = await request(app).get("/calls/config").expect(200);

    expect(response.body).toEqual({
      assistedCallingEnabled: false,
      voicemailLauncherUrl: null,
      computerCalling: {
        enabled: false,
        reason: "disabled",
        callerIdDisplay: null,
      },
    });
  });

  it("uses safe disabled defaults when the deployment flag is omitted", async () => {
    delete process.env.ASSISTED_CALLING_ENABLED;
    delete process.env.VOICEMAIL_LAUNCH_URL;

    const response = await request(app).get("/calls/config").expect(200);

    expect(response.body).toEqual({
      assistedCallingEnabled: false,
      voicemailLauncherUrl: null,
      computerCalling: {
        enabled: false,
        reason: "disabled",
        callerIdDisplay: null,
      },
    });
  });
});
