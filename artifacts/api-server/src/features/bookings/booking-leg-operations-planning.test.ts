import { expect, it, vi } from "vitest";
import { completeFacts, ids } from "../leg-planning/planning-fixtures";
import type { OperationsProviders } from "./booking-leg-operations-service";
const stub = vi.hoisted(() => ({
  facts: null as any,
  providers: null as OperationsProviders | null,
}));
vi.mock("@workspace/db", () => ({ pool: {}, db: {} }));
vi.mock("../../db/leg-planning-required-startup", () => ({
  legPlanningEnabled: () => true,
}));
vi.mock("../leg-planning/planning-facts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../leg-planning/planning-facts")>()),
  loadPlanFacts: async () => [stub.facts],
}));
vi.mock("./booking-leg-operations-service", () => ({
  BookingLegOperationsService: class {
    constructor(_repository: unknown, providers: OperationsProviders) {
      stub.providers = providers;
    }
  },
}));
import { createBookingLegOperationsService } from "./booking-leg-operations-providers";
it("embedded manager planning redacts decisions and split references after a branch moves away", async () => {
  const facts = completeFacts();
  facts.bookingLegIds = {
    [ids.booking]: ids.leg,
    [ids.otherBooking]: ids.otherBooking,
  };
  facts.split = {
    id: ids.split,
    parentLegId: ids.leg,
    bookingIds: [ids.booking, ids.otherBooking],
    revision: 1,
  };
  facts.requests = [
    {
      id: ids.set,
      type: "split",
      bookingIds: [ids.booking, ids.otherBooking],
      parentLegId: ids.leg,
      planFingerprint: "a".repeat(64),
      revision: 1,
      state: "decided",
      createdAt: "2026-10-01T00:00:00Z",
    },
  ];
  facts.decisions = [
    {
      id: ids.resource,
      requestId: ids.set,
      decision: "declined",
      reason: "Private other-leg decision",
      strategicAcknowledgement: false,
      actor: { kind: "manager", legId: ids.leg, sessionVersion: 1 },
      authorityRevision: 1,
      planFingerprint: "a".repeat(64),
      decidedAt: "2026-10-01T00:00:00Z",
    },
  ];
  stub.facts = facts;
  createBookingLegOperationsService(
    { query: async () => ({ rows: [] }) } as never,
    {} as never,
  );
  const read = await stub.providers!.planning!(ids.booking, {
    kind: "manager",
    legId: ids.leg,
  });
  expect(read!.requests).toEqual([]);
  expect(read!.decisions).toEqual([]);
  expect(read!.split).toBeNull();
  expect(read!.actions).toEqual({
    edit: false,
    commit: false,
    request: false,
    decide: false,
  });
});
