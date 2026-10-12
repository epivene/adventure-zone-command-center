// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  adminEmails: vi.fn(async () => ({ conversations: [] })),
  bossEmails: vi.fn(async () => ({ conversations: [] })),
  bossThread: vi.fn(), bossDrafts: vi.fn(),
  timeline: vi.fn(), emailPanel: vi.fn(), drafts: vi.fn(),
}));
vi.mock("@/features/google-workspace/google-workspace-client", () => ({ getGoogleProfileEmails: mocks.adminEmails }));
vi.mock("@/components/boss/boss-profile-emails", () => ({
  getBossProfileEmails: mocks.bossEmails, getBossThread: mocks.bossThread, getBossProfileDrafts: mocks.bossDrafts,
}));
vi.mock("@/components/activities/activity-timeline", () => ({
  ActivityTimeline: (props: any) => { mocks.timeline(props); return <div>Shared timeline</div>; },
}));
vi.mock("@/components/google-workspace/profile-google-email-panel", () => ({
  ProfileGoogleEmailPanel: (props: any) => { mocks.emailPanel(props); return <div>Shared email reader</div>; },
}));
vi.mock("@/components/profiles/profile-email-composer", () => ({
  ProfileEmailComposer: () => null,
  ProfileEmailDrafts: (props: any) => { mocks.drafts(props); return <div>Shared drafts</div>; },
}));
vi.mock("@/components/profiles/profile-actions-menu", () => ({ ProfileActionsMenu: () => null }));
vi.mock("@/components/profiles/profile-inline-editor", () => ({ ProfileInlineEditor: () => null }));
vi.mock("@/components/profiles/ProfileDesignDocuments", () => ({ ProfileDesignDocuments: () => <div>Design documents</div> }));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(), deleteActivityAction: vi.fn(), editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(), loadTimelinePageAction: vi.fn(),
}));
vi.mock("@/features/paper-notes/paper-note-client", () => ({ getPaperNoteActivitySource: vi.fn() }));
import { SimpleFullProfile } from "./simple-full-profile";
const profile = {
  id: "profile-1",
  place: { id: "profile-1", name: "County Fair", placeType: "fair", description: "Annual fair", city: "Dickinson", region: "ND", website: null, phone: null },
  contacts: [{ id: "contact-1", name: "Sam", isPrimary: true, email: "sam@example.org", phone: null, role: "Director" }],
  bookings: [{ id: "booking-1", name: "Fair 2027", status: "confirmed", startsAt: new Date("2027-07-01T12:00:00Z"), notes: "Returning fair" }],
  notes: [{ id: "note-1", kind: "note", body: "Ready to book", occurredAt: new Date("2026-09-01T12:00:00Z"), createdAt: new Date("2026-09-01T12:00:00Z"), updatedAt: new Date("2026-09-01T12:00:00Z") }],
  followUps: [{ id: "follow-up-1", kind: "call", dueAt: new Date("2027-02-01T12:00:00Z"), completedAt: null }],
  familyContext: { kind: "event_family", id: "family-1", name: "Fair Group" },
} as any;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("one profile renderer for admin and Dave", () => {
  it("combines the owner profile into three destinations without dropping its records or email history", () => {
    render(<SimpleFullProfile compact profile={profile} />);
    const navigation = within(screen.getByRole("navigation", { name: "Profile sections" }));
    expect(navigation.getAllByRole("button").map(button => button.textContent)).toEqual(["Overview", "Activity", "Records"]);
    fireEvent.click(navigation.getByRole("button", { name: "Records" }));
    expect(screen.getByRole("link", { name: /Fair 2027/ })).toHaveAttribute("href", "/bookings/booking-1");
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("href", "/contacts/contact-1");
    expect(screen.getByText("Design documents")).toBeInTheDocument();
    fireEvent.click(navigation.getByRole("button", { name: "Activity" }));
    expect(screen.getByText("Shared timeline")).toBeInTheDocument();
    expect(screen.getByText("Shared email reader")).toBeInTheDocument();
    expect(screen.getByText("Shared drafts")).toBeInTheDocument();
  });

  it("uses the same grouped destinations on the full profile and keeps recent activity in the overview", () => {
    render(<SimpleFullProfile profile={profile} />);
    const navigation = within(screen.getByRole("navigation", { name: "Profile sections" }));
    expect(navigation.getAllByRole("button").map(button => button.textContent)).toEqual(["Overview", "Activity", "Records"]);
    expect(screen.getByTestId("profile-latest-note")).toBeInTheDocument();
    expect(screen.getByTestId("profile-latest-email")).toBeInTheDocument();

    fireEvent.click(navigation.getByRole("button", { name: "Activity" }));
    expect(screen.getByText("Shared timeline")).toBeInTheDocument();
    expect(screen.getByText("Shared email reader")).toBeInTheDocument();
    expect(screen.getByText("Shared drafts")).toBeInTheDocument();

    fireEvent.click(navigation.getByRole("button", { name: "Records" }));
    expect(screen.getByRole("link", { name: /Fair 2027/ })).toHaveAttribute("href", "/bookings/booking-1");
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("href", "/contacts/contact-1");
    expect(screen.getByText("Design documents")).toBeInTheDocument();
  });
  it("uses identical overview content and section styling with fewer actions for Dave", async () => {
    const admin = render(<SimpleFullProfile profile={profile} ratingSummary={{ average: 4, count: 2 }} />);
    await waitFor(() => expect(mocks.adminEmails).toHaveBeenCalledWith(profile.id));
    const sectionClasses = Array.from(admin.container.querySelectorAll("section")).map((node) => node.className);
    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(screen.getByRole("button", { name: "Follow up" })).toBeInTheDocument();
    admin.unmount();

    const boss = render(<SimpleFullProfile profile={profile} role="boss" ratingSummary={{ average: 4, count: 2 }} />);
    await waitFor(() => expect(mocks.bossEmails).toHaveBeenCalledWith(profile.id));
    expect(Array.from(boss.container.querySelectorAll("section")).map((node) => node.className)).toEqual(sectionClasses);
    expect(screen.getAllByRole("heading").map((node) => node.textContent)).toEqual(headings);
    expect(screen.getByText("Fair Group")).toBeInTheDocument();
    expect(screen.getByText("2 rated occurrences")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Follow up|Add note|Assistant/ })).toBeNull();

    const navigation = within(screen.getByRole("navigation", { name: "Profile sections" }));
    expect(navigation.getAllByRole("button").map(button => button.textContent)).toEqual(["Overview", "Activity", "Records"]);
    fireEvent.click(navigation.getByRole("button", { name: "Records" }));
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("href", "/boss/contacts/contact-1");
    expect(screen.queryByRole("link", { name: "Add contact" })).toBeNull();
    expect(screen.getByRole("link", { name: /Fair 2027/ })).toHaveAttribute("href", "/boss/bookings/booking-1");
    expect(screen.queryByText("Design documents")).not.toBeInTheDocument();

    fireEvent.click(navigation.getByRole("button", { name: "Activity" }));
    expect(mocks.timeline.mock.calls.at(-1)?.[0]).toMatchObject({
      editActivity: undefined, deleteActivity: undefined, loadPage: undefined, openPaperNoteSource: undefined,
    });
    expect(screen.getByText("Shared timeline")).toBeInTheDocument();
    expect(mocks.emailPanel.mock.calls.at(-1)?.[0]).toMatchObject({ readOnly: true, getThread: mocks.bossThread });
    expect(mocks.drafts.mock.calls.at(-1)?.[0]).toMatchObject({ readOnly: true, getDrafts: mocks.bossDrafts });
  });
});
