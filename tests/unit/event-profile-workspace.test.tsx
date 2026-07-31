// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";

afterEach(cleanup);

const profile: EventProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  place: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "10 Mile Pride",
    placeType: "fair",
    phone: "970-555-0100",
    address1: "10 Main Street",
    address2: null,
    city: "Breckenridge",
    region: "CO",
    postalCode: "80424",
    website: null,
    lastResort: false,
    lastResortReason: null,
    actRecordId: "COMPANY-10-MILE",
  },
  contacts: [{
    id: "22222222-2222-4222-8222-222222222222",
    name: "Avery Able",
    role: "Director",
    isPrimary: true,
    phone: "970-555-0101",
    email: "avery@example.com",
    source: "act_migration",
    actRecordId: "CONTACT-AVERY",
  }],
  selectedContactId: "22222222-2222-4222-8222-222222222222",
  bookings: [{
    id: "33333333-3333-4333-8333-333333333333",
    name: "10 Mile Pride 2026",
    primaryContactId: "22222222-2222-4222-8222-222222222222",
    city: "Breckenridge",
    region: "CO",
    startsAt: new Date("2026-07-20T16:00:00Z"),
    endsAt: null,
    status: "interested",
    probability: "possible",
    notes: "Needs a quiet stage entrance.",
    actRecordId: "OPPORTUNITY-10-MILE",
  }],
  notes: [{
    id: "44444444-4444-4444-8444-444444444444",
    contactId: "22222222-2222-4222-8222-222222222222",
    bookingId: null,
    kind: "call",
    body: "Asked for an updated proposal.",
    occurredAt: new Date("2026-07-01T16:00:00Z"),
  }],
  followUps: [{
    id: "55555555-5555-4555-8555-555555555555",
    contactId: "22222222-2222-4222-8222-222222222222",
    bookingId: null,
    kind: "prepare_quote",
    dueAt: new Date("2026-07-02T16:00:00Z"),
    completedAt: null,
  }],
  groups: [{
    id: "66666666-6666-4666-8666-666666666666",
    name: "Colorado Pride Leads",
    kind: "static",
    source: "act_migration",
    sourceStatus: "active",
    actRecordId: "GROUP-CO-PRIDE",
  }],
  sourceProvenance: [{
    entityType: "organization",
    entityId: "11111111-1111-4111-8111-111111111111",
    sourceEntityType: "company",
    actRecordId: "COMPANY-10-MILE",
    isPrimary: true,
    syncMode: "pull_only",
  }],
};

describe("EventProfileWorkspace", () => {
  it("keeps event, calling, notes, follow-up, booking, and source context in one workspace", () => {
    render(<EventProfileWorkspace profile={profile} />);

    expect(screen.getByRole("heading", { name: "10 Mile Pride" })).toBeVisible();
    expect(screen.getByText("Breckenridge, CO")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Contacts" })).toBeVisible();
    expect(screen.getByText("Avery Able")).toBeVisible();
    expect(screen.getByText("Selected for calling")).toBeVisible();
    expect(screen.getByRole("link", { name: "Record call outcome" })).toHaveAttribute(
      "href",
      "/calls/new?organizationId=11111111-1111-4111-8111-111111111111&contactId=22222222-2222-4222-8222-222222222222",
    );
    expect(screen.getByRole("link", { name: "New event" })).toHaveAttribute(
      "href",
      "/event-profiles/new",
    );
    expect(screen.getByText("Asked for an updated proposal.")).toBeVisible();
    expect(screen.getByText(/prepare quote/i)).toBeVisible();
    expect(screen.getByText("10 Mile Pride 2026")).toBeVisible();
    expect(screen.getByText("Needs a quiet stage entrance.")).toBeVisible();
    expect(screen.getByText("Colorado Pride Leads")).toBeVisible();
    expect(screen.getByText("COMPANY-10-MILE")).toBeVisible();
  });

  it("renders Today booking, follow-up, action, and prospect context and carries it into the call", () => {
    render(
      <EventProfileWorkspace
        profile={profile}
        context={{
          bookingId: "33333333-3333-4333-8333-333333333333",
          followUpId: "55555555-5555-4555-8555-555555555555",
          action: "call",
          mode: "prospect",
        }}
      />,
    );

    expect(screen.getByText("Prospect mode")).toBeVisible();
    expect(screen.getByText("Selected booking context")).toBeVisible();
    expect(screen.getByText("Selected follow-up context")).toBeVisible();
    expect(screen.getByRole("link", { name: "Record call outcome" })).toHaveAttribute(
      "href",
      "/calls/new?organizationId=11111111-1111-4111-8111-111111111111&contactId=22222222-2222-4222-8222-222222222222&bookingId=33333333-3333-4333-8333-333333333333&followUpId=55555555-5555-4555-8555-555555555555&action=call&mode=prospect",
    );
  });
});
