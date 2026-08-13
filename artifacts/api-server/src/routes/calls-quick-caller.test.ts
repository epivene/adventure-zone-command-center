import express from "express";
import request from "supertest";
import { beforeEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  hasExactQuickCallerDuplicate: vi.fn(),
  findQuickCallerDuplicates: vi.fn(),
  createQuickCaller: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/contacts/contact-repository", () => ({
  DrizzleContactRepository: class {
    hasExactQuickCallerDuplicate = repository.hasExactQuickCallerDuplicate;
    findQuickCallerDuplicates = repository.findQuickCallerDuplicates;
    createQuickCaller = repository.createQuickCaller;
  },
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

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
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

const originalSecret = process.env.SESSION_SECRET;
let authorization = "";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(requireOwnerMiddleware, callsRouter);
  return instance;
}

beforeAll(() => {
  process.env.SESSION_SECRET = "task-7-route-test-secret";
  const issued = issueToken();
  if (!issued) throw new Error("Could not issue owner test token");
  authorization = `Bearer ${issued.token}`;
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

beforeEach(() => {
  vi.clearAllMocks();
  repository.hasExactQuickCallerDuplicate.mockResolvedValue(false);
  repository.findQuickCallerDuplicates.mockResolvedValue([]);
  repository.createQuickCaller.mockResolvedValue({
    kind: "created",
    contactId: "created-contact",
  });
});

describe("authenticated POST /calls/quick-caller", () => {
  it("rejects requests without the production owner authorization boundary", async () => {
    await request(app()).post("/calls/quick-caller").send(input).expect(401);
    expect(repository.hasExactQuickCallerDuplicate).not.toHaveBeenCalled();
  });

  it("returns an authoritative no-continue gate when an exact conflict is hidden beyond eight likely candidates", async () => {
    repository.hasExactQuickCallerDuplicate.mockResolvedValue(true);
    repository.findQuickCallerDuplicates.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        contactId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `Likely ${index}`,
        organizationName: "Prairie Days",
        city: "Minot",
        region: "ND",
        reasons: ["Name and organization"],
        kind: "likely",
      })),
    );

    const response = await request(app())
      .post("/calls/quick-caller")
      .set("Authorization", authorization)
      .send({ ...input, continueCreating: true })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: false,
      canContinueCreating: false,
      candidates: expect.arrayContaining([
        expect.objectContaining({ kind: "likely" }),
      ]),
    });
    expect(repository.createQuickCaller).not.toHaveBeenCalled();
  });

  it("marks bounded likely candidates as explicitly continuable", async () => {
    repository.findQuickCallerDuplicates.mockResolvedValue([{
      contactId: "likely",
      name: "Avery Lee",
      organizationName: "Prairie Days",
      city: "Minot",
      region: "ND",
      reasons: ["Name and organization"],
      kind: "likely",
    }]);

    const response = await request(app())
      .post("/calls/quick-caller")
      .set("Authorization", authorization)
      .send(input)
      .expect(200);

    expect(response.body).toMatchObject({
      ok: false,
      canContinueCreating: true,
      candidates: [{ contactId: "likely", kind: "likely" }],
    });
  });

  it("creates only after the explicit continuation reaches the service", async () => {
    repository.findQuickCallerDuplicates.mockResolvedValue([{
      contactId: "likely",
      name: "Avery Lee",
      organizationName: "Prairie Days",
      city: "Minot",
      region: "ND",
      reasons: ["Name and organization"],
      kind: "likely",
    }]);

    await request(app())
      .post("/calls/quick-caller")
      .set("Authorization", authorization)
      .send({ ...input, continueCreating: true })
      .expect(201, { ok: true, contactId: "created-contact" });

    expect(repository.createQuickCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        requestKey: input.requestKey,
        continueCreating: true,
      }),
    );
  });

  it("rejects an invalid body before any repository work", async () => {
    const response = await request(app())
      .post("/calls/quick-caller")
      .set("Authorization", authorization)
      .send({ ...input, name: "" })
      .expect(400);

    expect(response.body).toEqual({
      ok: false,
      error: "Enter the caller's name.",
    });
    expect(repository.hasExactQuickCallerDuplicate).not.toHaveBeenCalled();
  });
});

