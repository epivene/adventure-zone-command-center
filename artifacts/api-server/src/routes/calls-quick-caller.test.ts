import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitQuickCaller } = vi.hoisted(() => ({ submitQuickCaller: vi.fn() }));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/contacts/quick-caller-service", () => ({ submitQuickCaller }));
vi.mock("@/features/contacts/contact-repository", () => ({
  DrizzleContactRepository: class {},
}));
vi.mock("@/features/caller-finder/caller-finder-service", () => ({
  CallerFinderService: class { find = vi.fn(); },
}));
vi.mock("@/features/calls/call-repository", () => ({ DrizzleCallRepository: class {} }));
vi.mock("@/features/calls/call-service", () => ({ CallService: class {} }));
vi.mock("@/features/calls/call-input", () => ({
  completeCallInputSchema: { safeParse: vi.fn() },
}));
vi.mock("@/features/calls/call-workspace-context", () => ({
  DrizzleCallWorkspaceContextRepository: class {},
  activityTimelineParent: vi.fn(),
}));
vi.mock("@/features/activities/activity-service", () => ({ ActivityService: class {} }));
vi.mock("@/features/activities/activity-repository", () => ({ DrizzleActivityRepository: class {} }));
vi.mock("@/features/calls/call-workspace-query", () => ({ loadCallWorkspace: vi.fn() }));
vi.mock("@/features/bookings/booking-operations-summary", () => ({ createBookingOperationsSummaryProvider: vi.fn() }));
vi.mock("@/features/contact-phones/contact-phone-repository", () => ({ createContactPhoneRepository: vi.fn() }));

import callsRouter from "./calls";

const input = {
  requestKey: "99999999-9999-4999-8999-999999999999",
  name: "Avery Lee",
  organizationName: "Prairie Days",
  phone: "701-555-0199",
  email: "",
  reason: "New event inquiry",
  eventDate: "",
  eventLocation: "Minot, ND",
  continueCreating: false,
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(callsRouter);
  return instance;
}

beforeEach(() => submitQuickCaller.mockReset());

describe("POST /calls/quick-caller", () => {
  it("returns exact conflicts without creating even when bypass was requested", async () => {
    submitQuickCaller.mockResolvedValue({
      ok: false,
      candidates: [{ contactId: "existing", kind: "exact", reasons: ["Exact phone"] }],
    });

    const response = await request(app())
      .post("/calls/quick-caller")
      .send({ ...input, continueCreating: true })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: false,
      candidates: [{ contactId: "existing", kind: "exact" }],
    });
  });

  it("returns likely candidates for explicit review", async () => {
    submitQuickCaller.mockResolvedValue({
      ok: false,
      candidates: [{ contactId: "likely", kind: "likely", reasons: ["Name and organization"] }],
    });

    const response = await request(app()).post("/calls/quick-caller").send(input).expect(200);

    expect(response.body.candidates[0]).toMatchObject({ contactId: "likely", kind: "likely" });
    expect(submitQuickCaller).toHaveBeenCalledWith(
      expect.objectContaining({ requestKey: input.requestKey, continueCreating: false }),
      expect.anything(),
    );
  });

  it("forwards explicit continue creation using the same request key", async () => {
    submitQuickCaller.mockResolvedValue({ ok: true, contactId: "created" });

    await request(app())
      .post("/calls/quick-caller")
      .send({ ...input, continueCreating: true })
      .expect(201, { ok: true, contactId: "created" });

    expect(submitQuickCaller).toHaveBeenCalledWith(
      expect.objectContaining({ requestKey: input.requestKey, continueCreating: true }),
      expect.anything(),
    );
  });

  it("returns the same idempotent service result for a replayed request key", async () => {
    submitQuickCaller.mockResolvedValue({ ok: true, contactId: "created-once" });

    const first = await request(app()).post("/calls/quick-caller").send(input).expect(201);
    const replay = await request(app()).post("/calls/quick-caller").send(input).expect(201);

    expect(first.body).toEqual({ ok: true, contactId: "created-once" });
    expect(replay.body).toEqual(first.body);
    expect(submitQuickCaller.mock.calls[0]?.[0].requestKey).toBe(
      submitQuickCaller.mock.calls[1]?.[0].requestKey,
    );
  });
});
