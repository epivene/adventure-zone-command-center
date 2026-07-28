import { describe, expect, it } from "vitest";

import {
  activityTimelineParent,
  loadCallWorkspaceContext,
  type CallWorkspaceContextRepository,
} from "@/features/calls/call-workspace-context";
import { callWorkspaceHref } from "@/components/today/next-call-card";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";

const organizationId = "11111111-1111-4111-8111-111111111111";
const contactId = "22222222-2222-4222-8222-222222222222";
const secondaryContactId = "55555555-5555-4555-8555-555555555555";
const bookingId = "33333333-3333-4333-8333-333333333333";
const followUpId = "44444444-4444-4444-8444-444444444444";

type FollowUpRecord = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
};

class RecordingContextRepository implements CallWorkspaceContextRepository {
  calls: string[] = [];

  constructor(private readonly followUpRecord: FollowUpRecord = {
    id: followUpId,
    organizationId,
    contactId: null,
    bookingId: null,
  }) {}

  async findOrganization(id: string) {
    this.calls.push(`organization:${id}`);
    return id === organizationId
      ? { id, name: "Marias Fair", lastResort: false, lastResortReason: null }
      : null;
  }

  async findContact(id: string) {
    this.calls.push(`contact:${id}`);
    if (id === contactId) return { id, organizationId, firstName: "Avery", lastName: "Example", email: null, phone: null };
    if (id === secondaryContactId) return { id, organizationId, firstName: "Bailey", lastName: "Example", email: null, phone: null };
    return null;
  }

  async findBooking(id: string) {
    this.calls.push(`booking:${id}`);
    return id === bookingId
      ? { id, organizationId, primaryContactId: contactId, name: "Marias Fair 2026", city: "Shelby", region: "MT", status: "interested" as const, startsAt: null }
      : null;
  }

  async findFollowUp(id: string) {
    this.calls.push(`follow-up:${id}`);
    return id === this.followUpRecord.id ? this.followUpRecord : null;
  }
}

function queryFromToday(summary: FollowUpSummary) {
  const parameters = new URL(callWorkspaceHref(summary), "https://example.test").searchParams;
  return {
    contactId: parameters.get("contactId") ?? undefined,
    bookingId: parameters.get("bookingId") ?? undefined,
    followUpId: parameters.get("followUpId") ?? undefined,
  };
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

  it("accepts Today-generated booking follow-up queries for both primary fallback and explicit same-org contacts", async () => {
    const primarySummary: FollowUpSummary = {
      id: followUpId,
      contactId,
      bookingId,
      bookingName: "Marias Fair 2026",
      kind: "call",
      dueAt: new Date("2026-08-01T17:00:00Z"),
      createdAt: new Date("2026-07-28T17:00:00Z"),
      status: "due",
      probability: "likely",
    };
    const primaryRepository = new RecordingContextRepository({
      id: followUpId,
      organizationId,
      contactId: null,
      bookingId,
    });
    await expect(loadCallWorkspaceContext(
      queryFromToday(primarySummary),
      primaryRepository,
    )).resolves.toMatchObject({ ok: true, value: { contact: { id: contactId } } });

    const explicitSummary = { ...primarySummary, contactId: secondaryContactId };
    const explicitRepository = new RecordingContextRepository({
      id: followUpId,
      organizationId,
      contactId: secondaryContactId,
      bookingId,
    });
    await expect(loadCallWorkspaceContext(
      queryFromToday(explicitSummary),
      explicitRepository,
    )).resolves.toMatchObject({ ok: true, value: { contact: { id: secondaryContactId } } });
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
