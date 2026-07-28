import { describe, expect, it } from "vitest";

import {
  activityTimelineParent,
  loadCallWorkspaceContext,
  type CallWorkspaceContextRepository,
} from "@/features/calls/call-workspace-context";

const organizationId = "11111111-1111-4111-8111-111111111111";
const contactId = "22222222-2222-4222-8222-222222222222";
const bookingId = "33333333-3333-4333-8333-333333333333";
const followUpId = "44444444-4444-4444-8444-444444444444";

class RecordingContextRepository implements CallWorkspaceContextRepository {
  calls: string[] = [];

  async findOrganization(id: string) {
    this.calls.push(`organization:${id}`);
    return id === organizationId
      ? { id, name: "Marias Fair", lastResort: false, lastResortReason: null }
      : null;
  }

  async findContact(id: string) {
    this.calls.push(`contact:${id}`);
    return id === contactId
      ? { id, organizationId, firstName: "Avery", lastName: "Example", email: null, phone: null }
      : null;
  }

  async findBooking(id: string) {
    this.calls.push(`booking:${id}`);
    return id === bookingId
      ? { id, organizationId, primaryContactId: contactId, name: "Marias Fair 2026", city: "Shelby", region: "MT", status: "interested" as const, startsAt: null }
      : null;
  }

  async findFollowUp(id: string) {
    this.calls.push(`follow-up:${id}`);
    return id === followUpId
      ? { id, organizationId, contactId: null, bookingId: null }
      : null;
  }
}

describe("loadCallWorkspaceContext", () => {
  it("rejects malformed IDs before any repository work", async () => {
    const repository = new RecordingContextRepository();

    await expect(loadCallWorkspaceContext({ contactId: "not-a-uuid" }, repository)).resolves.toEqual({ ok: false });
    expect(repository.calls).toEqual([]);
  });

  it("derives an organization-only follow-up without inventing a contact or booking", async () => {
    const repository = new RecordingContextRepository();

    await expect(loadCallWorkspaceContext({ followUpId }, repository)).resolves.toMatchObject({
      ok: true,
      value: {
        organization: { id: organizationId },
        contact: null,
        booking: null,
        followUp: { id: followUpId },
      },
    });
  });

  it("rejects an added booking ID for an organization-only follow-up", async () => {
    const repository = new RecordingContextRepository();

    await expect(loadCallWorkspaceContext({ followUpId, bookingId }, repository)).resolves.toEqual({ ok: false });
  });

  it("rejects a contact ID that conflicts with the selected booking", async () => {
    const repository = new RecordingContextRepository();
    const anotherContactId = "55555555-5555-4555-8555-555555555555";

    await expect(loadCallWorkspaceContext({ contactId: anotherContactId, bookingId }, repository)).resolves.toEqual({ ok: false });
  });

  it("uses booking scope before contact scope before organization scope for recent history", () => {
    expect(activityTimelineParent({
      organization: { id: organizationId, name: "Marias Fair", lastResort: false, lastResortReason: null },
      contact: { id: contactId, organizationId, firstName: "Avery", lastName: "Example", email: null, phone: null },
      booking: { id: bookingId, organizationId, primaryContactId: contactId, name: "Marias Fair 2026", city: "Shelby", region: "MT", status: "interested", startsAt: null },
      followUp: null,
    })).toEqual({ bookingId });
  });
});
