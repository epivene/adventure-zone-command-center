// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const googleWorkspace = vi.hoisted(() => ({
  getGoogleProfileEmails: vi.fn(async () => ({
    liveGmail: true,
    validationSampleOnly: false,
    historicalBackfillIncluded: true,
    unavailableThreadCount: 0,
    conversations: [
      { threadId: "thread-1" },
      { threadId: "thread-2" },
    ],
  })),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => googleWorkspace);
vi.mock("@/components/activities/activity-timeline", () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline">Activity timeline rows</div>,
}));
vi.mock("@/components/google-workspace/profile-google-email-panel", () => ({
  ProfileGoogleEmailPanel: ({ organizationId }: { organizationId: string }) => (
    <div data-testid="profile-google-email-panel">Gmail history for {organizationId}</div>
  ),
}));
vi.mock("@/components/profiles/profile-actions-menu", () => ({
  ProfileActionsMenu: () => null,
}));
vi.mock("@/components/profiles/profile-inline-editor", () => ({
  ProfileInlineEditor: () => null,
}));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
  loadTimelinePageAction: vi.fn(),
}));
vi.mock("@/features/paper-notes/paper-note-client", () => ({
  getPaperNoteActivitySource: vi.fn(),
}));

import { SimpleFullProfile } from "./simple-full-profile";

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  place: {
    name: "Twin Falls County Fair",
    city: "Twin Falls",
    region: "ID",
    website: null,
    phone: null,
    placeType: "fair",
    lastResort: false,
    address1: null,
    address2: null,
    postalCode: null,
  },
  contacts: [],
  bookings: [],
  notes: [],
  followUps: [],
  familyContext: null,
} as any;

describe("SimpleFullProfile Gmail history", () => {
  it("shows the newest notes and Gmail conversations together in recent history", async () => {
    googleWorkspace.getGoogleProfileEmails.mockResolvedValueOnce({
      liveGmail: true,
      validationSampleOnly: false,
      historicalBackfillIncluded: true,
      unavailableThreadCount: 0,
      conversations: [{
        threadId: "thread-newer",
        subject: "Newer Gmail conversation",
        from: "organizer@example.com",
        to: "zone@example.com",
        date: "Tue, 1 Sep 2026 11:00:00 -0600",
        internalDateMs: new Date("2026-09-01T17:00:00.000Z").getTime(),
        hasAttachments: false,
        contactId: null,
        evidenceCodes: ["exact_contact_email"],
        originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-newer",
      }],
    });
    const profileWithOlderNote = {
      ...profile,
      notes: [{
        id: "note-older",
        contactId: null,
        bookingId: null,
        kind: "note",
        body: "Older profile note",
        occurredAt: new Date("2026-08-31T17:00:00.000Z"),
        createdAt: new Date("2026-08-31T17:00:00.000Z"),
        updatedAt: new Date("2026-08-31T17:00:00.000Z"),
        importedFromAct: false,
        actSourceType: null,
      }],
    } as any;

    render(<SimpleFullProfile profile={profileWithOlderNote} />);

    const recentHistory = screen.getByRole("heading", { name: "Recent history" }).closest("section");
    expect(recentHistory).not.toBeNull();
    await waitFor(() => expect(within(recentHistory!).getByText("Newer Gmail conversation")).toBeInTheDocument());
    const rows = within(recentHistory!).getAllByRole("article");
    expect(rows[0]).toHaveTextContent("email");
    expect(rows[0]).toHaveTextContent("Newer Gmail conversation");
    expect(rows[1]).toHaveTextContent("Older profile note");
  });

  it("gives live Gmail its own summary box and expandable section", async () => {
    const user = userEvent.setup();
    render(<SimpleFullProfile profile={profile} />);

    await waitFor(() => expect(googleWorkspace.getGoogleProfileEmails).toHaveBeenCalledWith(profile.id));
    await user.click(screen.getByRole("button", { name: "More actions" }));

    await user.click(screen.getByRole("menuitem", { name: "Open emails" }));
    expect(screen.getByTestId("profile-google-email-panel")).toHaveTextContent(
      "Gmail history for 11111111-1111-4111-8111-111111111111",
    );
  });

  it("keeps notes and Gmail in separate expandable sections", async () => {
    render(<SimpleFullProfile profile={profile} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument());

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Profile sections" })).getByRole("button", { name: "History" }),
    );
    expect(screen.getByRole("heading", { name: "Activity history" })).toBeInTheDocument();
    expect(screen.getByTestId("activity-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-google-email-panel")).not.toBeInTheDocument();
  });
});
