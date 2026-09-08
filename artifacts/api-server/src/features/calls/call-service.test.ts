import { describe, expect, it } from "vitest";

import { CallService } from "@/features/calls/call-service";
import type { CompleteCallInput } from "@/features/calls/call-types";

const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const phoneId = "30000000-0000-4000-8000-000000000001";

class CallTestRepository {
  readonly phone = {
    id: phoneId,
    contactId,
    number: "701-555-0100",
    extension: "12",
  };
  createdActivity: Record<string, unknown> | undefined;
  createdSession: Record<string, unknown> | undefined;
  suppressedPhoneId: string | undefined;
  updatedOrganization: Record<string, unknown> | undefined;
  phoneExists = true;
  replay: Record<string, unknown> | null = null;

  async transaction<T>(operation: (transaction: never) => Promise<T>): Promise<T> {
    return operation(this as never);
  }

  async lockRequest() {
    return this.replay;
  }

  async lockContext() {
    return {
      organization: {
        id: organizationId,
        name: "Acme Venue",
        lastResort: false,
        lastResortReason: null,
      },
      contact: {
        id: contactId,
        organizationId,
        firstName: "Avery",
        lastName: "Lee",
        jobTitle: null,
        email: null,
        phone: this.phone.number,
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
      },
      booking: null,
      followUp: null,
      contactHasActiveOrganizationRelationship: true,
      contactHasBookingRelationship: null,
    };
  }

  async createActivity(input: Record<string, unknown>) {
    this.createdActivity = input;
    return { id: "40000000-0000-4000-8000-000000000001" };
  }

  async createCallSession(input: Record<string, unknown>) {
    this.createdSession = input;
    return { id: "50000000-0000-4000-8000-000000000001" };
  }

  async completeFollowUp() {}
  async createFollowUp() {
    return { id: "60000000-0000-4000-8000-000000000001" };
  }
  async linkNextFollowUp() {}
  async updateBooking() {
    throw new Error("No booking is linked to this call.");
  }
  async updateContact() {
    return {};
  }
  async setLastResort() {
    this.updatedOrganization = {};
  }
  async createAuditEntry() {}
  async lockContactPhone() {
    return this.phoneExists ? this.phone : null;
  }
  async markPhoneDoNotCall(id: string) {
    this.suppressedPhoneId = id;
  }
}

function validCall(overrides: Record<string, unknown> = {}) {
  return {
    requestKey: "70000000-0000-4000-8000-000000000001",
    organizationId,
    contactId,
    bookingId: null,
    followUpId: null,
    note: "Discussed the event details.",
    disposition: "follow_up_needed",
    resultingBookingStatus: null,
    startedAt: new Date("2026-08-12T15:00:00.000Z"),
    endedAt: new Date("2026-08-12T15:05:00.000Z"),
    nextAction: {
      kind: "Call back",
      dueAt: new Date("2026-08-13T15:00:00.000Z"),
    },
    lastResortReason: null,
    lastResortConfirmed: false,
    approvedContactUpdates: null,
    approvedBookingUpdates: null,
    direction: "outgoing",
    method: "office_call",
    phoneId,
    scriptKind: "follow_up",
    doNotCallConfirmed: false,
    doNotCallReason: null,
    doNotCallPhoneId: null,
    entryMode: "desktop",
    ...overrides,
  } as CompleteCallInput;
}

describe("CallService call metadata", () => {
  it("accepts browser VoIP completion metadata", async () => {
    const repository = new CallTestRepository();
    const service = new CallService(repository as never, {
      now: () => new Date("2026-08-12T16:00:00.000Z"),
    });

    const result = await service.complete(validCall({
      requestKey: "70000000-0000-4000-8000-000000000007",
      method: "browser_voip",
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
      endedAt: new Date("2026-09-01T10:03:15.000Z"),
    }));

    expect(result.ok).toBe(true);
    expect(repository.createdSession).toMatchObject({
      method: "browser_voip",
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
      endedAt: new Date("2026-09-01T10:03:15.000Z"),
    });
  });

  it("persists the selected phone snapshot and call method", async () => {
    const repository = new CallTestRepository();
    const service = new CallService(repository as never, {
      now: () => new Date("2026-08-12T16:00:00.000Z"),
    });

    const result = await service.complete(validCall());

    expect(result.ok).toBe(true);
    expect(repository.createdSession).toMatchObject({
      direction: "outgoing",
      method: "office_call",
      phoneId,
      phoneNumberSnapshot: "701-555-0100",
      phoneExtensionSnapshot: "12",
      scriptKind: "follow_up",
    });
  });

  it("allows a quick outcome with blank note and no next action", async () => {
    const repository = new CallTestRepository();
    const service = new CallService(repository as never, {
      now: () => new Date("2026-08-12T16:00:00.000Z"),
    });

    const result = await service.complete(validCall({
      note: "",
      disposition: "no_answer",
      nextAction: null,
    }));

    expect(result.ok).toBe(true);
    expect(repository.createdActivity).toMatchObject({ body: "No answer." });
    expect(repository.createdSession).toMatchObject({ disposition: "no_answer" });
  });

  it("marks only the selected number Do Not Call after confirmation", async () => {
    const repository = new CallTestRepository();
    const service = new CallService(repository as never, {
      now: () => new Date("2026-08-12T16:00:00.000Z"),
    });

    await service.complete(validCall({
      disposition: "do_not_call",
      doNotCallConfirmed: true,
      doNotCallReason: "Requested during call",
      doNotCallPhoneId: phoneId,
    }));

    expect(repository.suppressedPhoneId).toBe(phoneId);
    expect(repository.updatedOrganization).toBeUndefined();
  });

  it("replays without overwriting a session that already contains metadata", async () => {
    const repository = new CallTestRepository();
    repository.replay = { id: "50000000-0000-4000-8000-000000000001", noteActivityId: "40000000-0000-4000-8000-000000000001", disposition: "follow_up_needed", nextFollowUpId: null, resultingBookingStatus: null, phoneId, phoneNumberSnapshot: "701-555-0100", phoneExtensionSnapshot: "12" };
    const result = await new CallService(repository as never).complete(validCall());
    expect(result.ok).toBe(true);
    expect(repository.createdSession).toBeUndefined();
    expect(repository.replay).toMatchObject({ phoneId, phoneNumberSnapshot: "701-555-0100" });
  });

  it("rejects a selected phone that does not belong to the linked contact", async () => {
    const repository = new CallTestRepository();
    repository.phoneExists = false;
    const result = await new CallService(repository as never).complete(validCall());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CALL_INPUT");
  });

  it.each([
    ["confirmation", { doNotCallConfirmed: false, doNotCallReason: "Requested" }],
    ["a reason", { doNotCallConfirmed: true, doNotCallReason: null }],
  ])("rejects Do Not Call without %s", async (_missing, overrides) => {
    const result = await new CallService(new CallTestRepository() as never).complete(validCall({
      disposition: "do_not_call",
      ...overrides,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CALL_INPUT");
  });

  it("keeps wrong numbers unsuppressed while retaining their snapshot", async () => {
    const repository = new CallTestRepository();
    const result = await new CallService(repository as never, {
      now: () => new Date("2026-08-12T16:00:00.000Z"),
    }).complete(validCall({ disposition: "wrong_number" }));
    expect(result.ok).toBe(true);
    expect(repository.suppressedPhoneId).toBeUndefined();
    expect(repository.createdSession).toMatchObject({ disposition: "wrong_number", phoneNumberSnapshot: "701-555-0100" });
  });

});
