// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const ownerApi = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn() }));
vi.mock("@/lib/auth-token", () => ownerApi);

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

describe("profile email entry points", () => {
  it("opens the composer from the profile header and Emails, then reopens a saved draft", async () => {
    googleWorkspace.getGoogleProfileEmails.mockResolvedValue({ conversations: [] } as any);
    ownerApi.apiGet.mockResolvedValue({ drafts: [] });
    const draft = { id: "draft-1", organizationId: profile.id, contactId: "contact-1", recipientEmail: "fair@example.org", subject: "Fair plans", body: "Hello", state: "draft" };
    ownerApi.apiPost.mockResolvedValue({ draft });
    render(<SimpleFullProfile profile={{ ...profile, contacts: [{ id: "contact-1", name: "Kellie", email: "fair@example.org" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Email" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "Close" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /0\s*Emails/ }));
    const section = screen.getByRole("heading", { name: "Email drafts" }).closest("section")!;
    fireEvent.click(within(section).getByRole("button", { name: "Create Email" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: draft.subject } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: draft.body } });
    ownerApi.apiGet.mockResolvedValue({ drafts: [draft] });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent");
    fireEvent.click(await screen.findByRole("button", { name: /Fair plans.*Open to edit/ }));
    expect(screen.getByLabelText("Email")).toHaveValue("Hello");
    expect(ownerApi.apiPost).toHaveBeenCalledTimes(1);
  });
});
