// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";
import { NextCallCard } from "@/components/today/next-call-card";
import {
  CallService,
  type CallRepository,
  type CallTransaction,
} from "@/features/calls/call-service";
import type {
  CallContext,
  CompleteCallInput,
} from "@/features/calls/call-types";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";

afterEach(cleanup);

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  contact: "22222222-2222-4222-8222-222222222222",
  booking: "33333333-3333-4333-8333-333333333333",
  followUp: "44444444-4444-4444-8444-444444444444",
};

const dueAt = new Date("2026-08-03T16:00:00.000Z");

const todayFollowUp: FollowUpSummary = {
  id: ids.followUp,
  organizationId: ids.organization,
  contactId: ids.contact,
  bookingId: ids.booking,
  bookingName: "10 Mile Pride 2026",
  kind: "call",
  dueAt,
  createdAt: new Date("2026-08-01T16:00:00.000Z"),
  status: "due",
  probability: "possible",
};

const profile: EventProfile = {
  id: ids.organization,
  place: {
    id: ids.organization,
    name: "10 Mile Pride",
    placeType: "fair",
    phone: "970-555-0101",
    address1: "10 Main St",
    address2: null,
    city: "Breckenridge",
    region: "CO",
    postalCode: null,
    website: null,
    lastResort: false,
    lastResortReason: null,
    actRecordId: "PRIDE-A",
  },
  contacts: [{
    id: ids.contact,
    name: "Avery Able",
    role: "Coordinator",
    isPrimary: true,
    phone: "970-555-0111",
    email: "avery@example.test",
    source: "act_migration",
    actRecordId: "CONTACT-SHARED",
  }],
  selectedContactId: ids.contact,
  bookings: [{
    id: ids.booking,
    name: todayFollowUp.bookingName,
    primaryContactId: ids.contact,
    city: "Breckenridge",
    region: "CO",
    startsAt: new Date("2026-08-10T16:00:00.000Z"),
    endsAt: null,
    status: "possible",
    probability: "possible",
    notes: null,
    actRecordId: "BOOKING-10-MILE",
  }],
  notes: [],
  followUps: [{
    id: ids.followUp,
    contactId: ids.contact,
    bookingId: ids.booking,
    kind: "call",
    dueAt,
    completedAt: null,
  }],
  groups: [],
  sourceProvenance: [{
    entityType: "organization",
    entityId: ids.organization,
    sourceEntityType: "company",
    actRecordId: "PRIDE-A",
    isPrimary: true,
    syncMode: "pull_only",
  }],
};

class ProfileWorkflowRepository implements CallRepository {
  context: CallContext = {
    organization: { id: ids.organization, name: "10 Mile Pride", lastResort: false, lastResortReason: null },
    contact: {
      id: ids.contact,
      organizationId: ids.organization,
      firstName: "Avery",
      lastName: "Able",
      jobTitle: "Coordinator",
      email: "avery@example.test",
      phone: "970-555-0111",
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
    },
    booking: {
      id: ids.booking,
      organizationId: ids.organization,
      primaryContactId: ids.contact,
      name: "10 Mile Pride 2026",
      city: "Breckenridge",
      region: "CO",
      probability: "possible",
      venueName: null,
      address1: null,
      postalCode: null,
      latitude: null,
      longitude: null,
      startsAt: new Date("2026-08-10T16:00:00.000Z"),
      endsAt: null,
      travelLegId: null,
      notes: null,
      status: "possible",
    },
    followUp: { id: ids.followUp, organizationId: ids.organization, contactId: ids.contact, bookingId: ids.booking, completedAt: null, outcome: null, nextFollowUpId: null },
    contactHasActiveOrganizationRelationship: true,
    contactHasBookingRelationship: true,
  };
  private loadedProfile: EventProfile = structuredClone(profile);
  readonly createdFollowUps: Parameters<CallTransaction["createFollowUp"]>[0][] = [];
  completedFollowUpId: string | null = null;

  async transaction<T>(operation: (transaction: CallTransaction) => Promise<T>) {
    const transaction: CallTransaction = {
      lockRequest: async () => null,
      lockContext: async () => this.context,
      createActivity: async (input) => {
        this.loadedProfile.notes.unshift({
          id: "activity-1",
          contactId: input.contactId,
          bookingId: input.bookingId,
          kind: "call",
          body: input.body,
          occurredAt: input.occurredAt,
        });
        return { id: "activity-1" };
      },
      createCallSession: async () => ({ id: "call-1" }),
      completeFollowUp: async (followUpId) => {
        this.completedFollowUpId = followUpId;
        const followUp = this.loadedProfile.followUps.find(({ id }) => id === followUpId);
        if (followUp) followUp.completedAt = new Date("2026-08-03T16:05:00.000Z");
      },
      createFollowUp: async (input) => {
        this.createdFollowUps.push(input);
        this.loadedProfile.followUps.unshift({
          id: "follow-up-next",
          contactId: input.contactId,
          bookingId: input.bookingId,
          kind: input.kind,
          dueAt: input.dueAt,
          completedAt: null,
        });
        return { id: "follow-up-next" };
      },
      linkNextFollowUp: async () => undefined,
      updateBooking: async (_bookingId, updates) => {
        this.context.booking = { ...this.context.booking!, ...updates };
        const booking = this.loadedProfile.bookings.find(({ id }) => id === _bookingId);
        if (booking && typeof updates.status === "string") booking.status = updates.status as typeof booking.status;
        return this.context.booking;
      },
      updateContact: async () => ({}),
      setLastResort: async () => undefined,
      createAuditEntry: async () => undefined,
    };
    return operation(transaction);
  }

  loadProfile() {
    return structuredClone(this.loadedProfile);
  }
}

function callInput(): CompleteCallInput {
  return {
    requestKey: "55555555-5555-4555-8555-555555555555",
    organizationId: ids.organization,
    contactId: ids.contact,
    bookingId: ids.booking,
    followUpId: ids.followUp,
    note: "Send the updated proposal.",
    disposition: "proposal_contract_sent",
    resultingBookingStatus: "pending_contract",
    startedAt: new Date("2026-08-03T16:00:00.000Z"),
    endedAt: new Date("2026-08-03T16:05:00.000Z"),
    nextAction: { kind: "send quote", dueAt: new Date("2026-08-05T16:00:00.000Z") },
    lastResortReason: null,
    lastResortConfirmed: false,
    approvedContactUpdates: null,
    approvedBookingUpdates: null,
  };
}

describe("event profile calling workflow", () => {
  it("keeps Today, profile context, call completion, next follow-up, and booking status on one event", async () => {
    render(<NextCallCard followUp={todayFollowUp} />);
    expect(screen.getByRole("link", { name: todayFollowUp.bookingName })).toHaveAttribute(
      "href",
      `/event-profiles/${ids.organization}?contactId=${ids.contact}&bookingId=${ids.booking}&followUpId=${ids.followUp}&action=call`,
    );
    cleanup();

    render(<EventProfileWorkspace profile={profile} context={{ bookingId: ids.booking, followUpId: ids.followUp, action: "call" }} />);
    expect(screen.getByRole("link", { name: "Record call outcome" })).toHaveAttribute(
      "href",
      `/calls/new?organizationId=${ids.organization}&contactId=${ids.contact}&bookingId=${ids.booking}&followUpId=${ids.followUp}&action=call`,
    );
    expect(screen.getByText("Selected booking context")).toBeVisible();
    expect(screen.getByText("Selected follow-up context")).toBeVisible();

    const repository = new ProfileWorkflowRepository();
    const completed = await new CallService(repository, {
      now: () => new Date("2026-08-03T16:05:00.000Z"),
    }).complete(callInput());

    expect(completed).toMatchObject({
      ok: true,
      value: { resultingBookingStatus: "pending_contract", nextFollowUpId: "follow-up-next" },
    });
    expect(repository.completedFollowUpId).toBe(ids.followUp);
    expect(repository.createdFollowUps).toEqual([{
      organizationId: ids.organization,
      contactId: ids.contact,
      bookingId: ids.booking,
      kind: "send quote",
      dueAt: new Date("2026-08-05T16:00:00.000Z"),
    }]);
    const reloaded = repository.loadProfile();
    expect(reloaded.notes[0]).toMatchObject({
      body: "Send the updated proposal.",
      contactId: ids.contact,
      bookingId: ids.booking,
    });
    expect(reloaded.followUps.find(({ id }) => id === ids.followUp)?.completedAt).toEqual(
      new Date("2026-08-03T16:05:00.000Z"),
    );
    expect(reloaded.followUps[0]).toMatchObject({ id: "follow-up-next", bookingId: ids.booking, contactId: ids.contact });
    expect(reloaded.bookings.find(({ id }) => id === ids.booking)?.status).toBe("pending_contract");

    cleanup();
    render(<EventProfileWorkspace profile={reloaded} context={{ bookingId: ids.booking, followUpId: "follow-up-next", action: "follow-up" }} />);
    expect(screen.getByText("Send the updated proposal.")).toBeVisible();
    expect(screen.getByText(/pending contract/i)).toBeVisible();
    expect(screen.getByText("Selected follow-up context")).toBeVisible();
  });
});
