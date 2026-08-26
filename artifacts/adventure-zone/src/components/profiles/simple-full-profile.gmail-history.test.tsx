// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("gives live Gmail its own summary box and expandable section", async () => {
    render(<SimpleFullProfile profile={profile} />);

    await waitFor(() => expect(googleWorkspace.getGoogleProfileEmails).toHaveBeenCalledWith(profile.id));
    expect(screen.getByRole("button", { name: /2 Emails/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /2 Emails/ }));
    expect(screen.getByTestId("profile-google-email-panel")).toHaveTextContent(
      "Gmail history for 11111111-1111-4111-8111-111111111111",
    );
  });

  it("keeps notes and Gmail in separate expandable sections", async () => {
    render(<SimpleFullProfile profile={profile} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /2 Emails/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Notes/ }));
    expect(screen.getByRole("heading", { name: "Activity history" })).toBeInTheDocument();
    expect(screen.getByTestId("activity-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-google-email-panel")).not.toBeInTheDocument();
  });
});
