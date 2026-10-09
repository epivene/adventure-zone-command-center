// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

const gmail = vi.hoisted(() => ({
  state: {
    conversations: [] as any[],
    current: [] as any[],
    historical: [] as any[],
    loading: false,
    error: null as string | null,
    reload: vi.fn(),
  },
}));
const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  createProfileEmailProject: vi.fn(),
}));

vi.mock("@/components/google-workspace/use-profile-google-email", () => ({
  useProfileGoogleEmail: () => gmail.state,
}));
vi.mock("@/components/google-workspace/profile-google-email-panel", () => ({
  ProfileGoogleConversationCard: ({ conversation }: any) => (
    <button type="button">Open conversation {conversation.subject}</button>
  ),
}));
vi.mock("@/lib/auth-token", () => ({ apiGet: api.apiGet }));
vi.mock("@/features/design-studio/profile-email-studio", async () => {
  const actual = await vi.importActual<any>(
    "@/features/design-studio/profile-email-studio",
  );
  return {
    ...actual,
    createProfileEmailProject: api.createProfileEmailProject,
  };
});

import { ProfileEmailSummary } from "./profile-email-summary";

const contacts = [
  { id: "contact-1", name: "Jamie", email: "gm@example.com", isPrimary: true },
];

beforeEach(() => {
  gmail.state = {
    conversations: [1, 2, 3, 4].map((number) => ({
      threadId: `thread-${number}`,
      subject: `Conversation ${number}`,
    })),
    current: [],
    historical: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  };
  api.apiGet.mockReset().mockResolvedValue({
    drafts: [
      {
        id: "draft-1",
        subject: "October outreach",
        recipientEmail: "gm@example.com",
        state: "scheduled",
      },
      {
        id: "draft-2",
        subject: "Follow-up after the fair",
        recipientEmail: "gm@example.com",
        state: "draft",
      },
      {
        id: "draft-3",
        subject: "Needs a revision",
        recipientEmail: "gm@example.com",
        state: "needs_changes",
      },
      {
        id: "sent-1",
        subject: "Already sent",
        recipientEmail: "gm@example.com",
        state: "sent",
      },
    ],
  });
  api.createProfileEmailProject
    .mockReset()
    .mockResolvedValue({ id: "project-1" });
});

describe("ProfileEmailSummary", () => {
  it("shows the primary email, three newest conversations, and active draft state", async () => {
    render(
      <Router>
        <ProfileEmailSummary
          contacts={contacts}
          organizationId="org-1"
          organizationName="Prairie Days"
        />
      </Router>,
    );

    expect(screen.getByText("gm@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "New Draft" })).toBeEnabled();
    expect(
      screen.getAllByRole("button", { name: /Open conversation/ }),
    ).toHaveLength(3);
    expect(await screen.findByText("Scheduled")).toBeVisible();
    expect(screen.getByText("Not editable here")).toBeVisible();
    expect(screen.getByTestId("link-open-email-draft-draft-2")).toHaveAttribute(
      "href",
      "/profiles/org-1?section=emails&draftId=draft-2",
    );
    expect(screen.getByTestId("link-open-email-draft-draft-3")).toHaveAttribute(
      "href",
      "/profiles/org-1?section=emails&draftId=draft-3",
    );
    expect(screen.queryByTestId("link-open-email-draft-draft-1")).not.toBeInTheDocument();
    expect(screen.queryByText("Already sent")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View all emails" }),
    ).toHaveAttribute("href", "/profiles/org-1?section=emails");
  });

  it("creates the linked project and opens Design Studio", async () => {
    let location = "/profiles?selected=org-1";
    const navigate = vi.fn((next: string) => {
      location = next;
    });
    render(
      <Router hook={() => [location, navigate]}>
        <ProfileEmailSummary
          contacts={contacts}
          organizationId="org-1"
          organizationName="Prairie Days"
        />
      </Router>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Draft" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/design-studio/project-1?returnTo=%2Fprofiles%3Fselected%3Dorg-1",
        undefined,
      ),
    );
  });

  it("shows useful missing-email and Gmail-error states without hiding drafts", async () => {
    gmail.state = {
      ...gmail.state,
      conversations: [],
      error: "Gmail unavailable",
    };
    render(
      <Router>
        <ProfileEmailSummary
          contacts={[
            { id: "contact-1", name: "Jamie", email: null, isPrimary: true },
          ]}
          organizationId="org-1"
          organizationName="Prairie Days"
        />
      </Router>,
    );

    expect(screen.getByText("No primary contact email")).toBeVisible();
    expect(screen.getByRole("button", { name: "New Draft" })).toBeDisabled();
    expect(screen.getByText("Add a contact email first")).toBeVisible();
    expect(screen.getByText("Gmail unavailable")).toBeVisible();
    expect(await screen.findByText("Scheduled")).toBeVisible();
  });
});
