// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/event-profiles/profile-1", vi.fn()],
}));
vi.mock("@/components/activities/activity-timeline", () => ({ ActivityTimeline: () => null }));
vi.mock("@/components/follow-ups/follow-up-controls", () => ({ FollowUpControls: () => null }));
vi.mock("@/components/organizations/possible-locations-drawer", () => ({ PossibleLocationsDrawer: () => null }));
vi.mock("@/components/notes/scoped-notes", () => ({ ScopedNotes: () => null }));
vi.mock("@/actions/activities", () => ({ createActivityAction: vi.fn(), deleteActivityAction: vi.fn(), editActivityAction: vi.fn(), listActivityRevisionsAction: vi.fn(), loadTimelinePageAction: vi.fn() }));
vi.mock("@/actions/follow-ups", () => ({ deleteFollowUpAction: vi.fn(), editFollowUpAction: vi.fn() }));

import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";

const baseProfile: any = {
  id: "profile-1",
  selectedContactId: null,
  place: { id: "profile-1", name: "Denver Lantern", placeType: "festival_event", phone: null, address1: null, city: "Denver", region: "CO", postalCode: null, website: null, lastResort: false, lastResortReason: null },
  contacts: [], bookings: [], followUps: [], notes: [], groups: [], familyContext: null,
};

afterEach(cleanup);

describe("profile organization membership controls", () => {
  it("shows parent context and change action for a child profile", () => {
    render(<EventProfileWorkspace profile={baseProfile} organizationContext={{ parent: { id: "parent-1", name: "Water Lantern Festival", city: null, region: null }, children: [] }} onOrganizationChanged={vi.fn()} />);
    expect(screen.getByText(/Part of/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Water Lantern Festival" })).toHaveAttribute("href", "/event-profiles/parent-1");
    expect(screen.getByRole("button", { name: "Change organization…" })).toBeInTheDocument();
  });

  it("offers Add to organization for an ungrouped event profile", () => {
    render(<EventProfileWorkspace profile={baseProfile} organizationContext={{ parent: null, children: [] }} onOrganizationChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add to organization…" })).toBeInTheDocument();
  });

  it("shows Locations & Events and add action on an organization profile", () => {
    const organization = { ...baseProfile, place: { ...baseProfile.place, name: "Water Lantern Festival", placeType: "company" } };
    render(<EventProfileWorkspace profile={organization} organizationContext={{ parent: null, children: [{ id: "child-1", name: "Denver Lantern", city: "Denver", region: "CO" }] }} onOrganizationChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Locations & Events" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Denver Lantern/ })).toHaveAttribute("href", "/event-profiles/child-1");
    fireEvent.click(screen.getByRole("button", { name: "+ Add location/event" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps Event Family context separate from organization context", () => {
    const familyProfile = { ...baseProfile, familyContext: { kind: "event_family", id: "family-1", name: "Fourth of July" } };
    render(<EventProfileWorkspace profile={familyProfile} organizationContext={{ parent: { id: "parent-1", name: "Holiday Events Inc", city: null, region: null }, children: [] }} onOrganizationChanged={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Fourth of July" })).toHaveAttribute("href", "/event-families/family-1");
    expect(screen.getByRole("link", { name: "Holiday Events Inc" })).toHaveAttribute("href", "/event-profiles/parent-1");
  });
});
