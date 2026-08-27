import { describe, expect, it } from "vitest";

import { completeCallInputSchema } from "@/features/calls/call-input";
import { CallService } from "@/features/calls/call-service";
import {
  persistedCallDisposition,
  publicCallDisposition,
  type CompleteCallInput,
} from "@/features/calls/call-types";

const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";

function emailRequestedCall() {
  return {
    requestKey: "70000000-0000-4000-8000-000000000001",
    organizationId,
    contactId,
    bookingId: null,
    followUpId: null,
    note: "",
    disposition: "email_requested",
    resultingBookingStatus: null,
    startedAt: new Date("2026-08-26T20:00:00.000Z"),
    endedAt: new Date("2026-08-26T20:05:00.000Z"),
    nextAction: null,
    lastResortReason: null,
    lastResortConfirmed: false,
    approvedContactUpdates: null,
    approvedBookingUpdates: null,
    direction: "outgoing",
    method: "standard_call",
    phoneId: null,
    scriptKind: "first_outreach",
    doNotCallConfirmed: false,
    doNotCallReason: null,
    doNotCallPhoneId: null,
    entryMode: "desktop",
  };
}

class TestRepository {
  createdActivity: Record<string, unknown> | null = null;
  createdSession: Record<string, unknown> | null = null;

  transaction<T>(operation: (transaction: never) => Promise<T>): Promise<T> {
    return operation(this as never);
  }
  async lockRequest() { return null; }
  async lockContext() {
    return {
      organization: { id: organizationId, name: "Example Event", lastResort: false, lastResortReason: null },
      contact: {
        id: contactId,
        organizationId,
        firstName: "Avery",
        lastName: "Lee",
        jobTitle: null,
        email: "avery@example.test",
        phone: null,
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
  async lockContactPhone() { return null; }
  async createActivity(input: Record<string, unknown>) {
    this.createdActivity = input;
    return { id: "40000000-0000-4000-8000-000000000001" };
  }
  async createCallSession(input: Record<string, unknown>) {
    this.createdSession = input;
    return { id: "50000000-0000-4000-8000-000000000001" };
  }
  async completeFollowUp() {}
  async createFollowUp() { return { id: "60000000-0000-4000-8000-000000000001" }; }
  async linkNextFollowUp() {}
  async updateBooking() { throw new Error("No booking"); }
  async updateContact() { return {}; }
  async setLastResort() {}
  async createAuditEntry() {}
  async markPhoneDoNotCall() {}
}

describe("email requested call outcome", () => {
  it("accepts and round-trips email_requested", () => {
    const parsed = completeCallInputSchema.safeParse(emailRequestedCall());
    expect(parsed.success).toBe(true);
    expect((persistedCallDisposition as Record<string, string>).email_requested).toBe("email_requested");
    expect((publicCallDisposition as Record<string, string>).email_requested).toBe("email_requested");
  });

  it("uses the approved default note when the note is blank", async () => {
    const repository = new TestRepository();
    const result = await new CallService(repository as never, {
      now: () => new Date("2026-08-26T20:06:00.000Z"),
    }).complete(emailRequestedCall() as unknown as CompleteCallInput);

    expect(result.ok).toBe(true);
    expect(repository.createdActivity).toMatchObject({
      body: "Asked us to send information by email.",
    });
    expect(repository.createdSession).toMatchObject({ disposition: "email_requested" });
  });
});
