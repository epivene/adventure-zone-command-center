import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleProfileEmails: vi.fn(),
  getGoogleProfileEmailThread: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);

import { ProfileGoogleEmailPanel } from "./profile-google-email-panel";

beforeEach(() => {
  client.getGoogleProfileEmails.mockResolvedValue({
    validationSampleOnly: true,
    conversations: [
      {
        threadId: "thread-1",
        subject: "County Fair follow up",
        from: "fair@example.org",
        to: "zone@example.com",
        date: "Mon, 24 Aug 2026 10:00:00 -0600",
        internalDateMs: 1000,
        hasAttachments: true,
        contactId: "contact-1",
        evidenceCodes: ["exact_contact_email", "contact_active_organization"],
        originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
      },
    ],
  });
  client.getGoogleProfileEmailThread.mockResolvedValue({
    id: "thread-1",
    subject: "County Fair follow up",
    originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
    messages: [
      {
        id: "m1",
        internalDateMs: 1000,
        from: "fair@example.org",
        to: "zone@example.com",
        cc: "",
        subject: "County Fair follow up",
        date: "Mon, 24 Aug 2026 10:00:00 -0600",
        direction: "incoming",
        bodyText: "We would like to book you again.",
        attachments: [
          {
            attachmentId: "a1",
            filename: "application.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1200,
            messageId: "m1",
          },
        ],
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileGoogleEmailPanel", () => {
  it("gives matched Gmail conversations their own Emails area on the profile", async () => {
    render(<ProfileGoogleEmailPanel organizationId="org-1" />);

    expect(await screen.findByRole("heading", { name: "Emails" })).toBeInTheDocument();
    expect(await screen.findByText("County Fair follow up")).toBeInTheDocument();
    expect(screen.getByText(/approved validation sample/i)).toBeInTheDocument();
  });

  it("opens the complete readable thread and lists attachments", async () => {
    render(<ProfileGoogleEmailPanel organizationId="org-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /County Fair follow up/i }));

    await waitFor(() =>
      expect(client.getGoogleProfileEmailThread).toHaveBeenCalledWith(
        "org-1",
        "thread-1",
      ),
    );
    expect(await screen.findByText("We would like to book you again.")).toBeInTheDocument();
    expect(screen.getByText("application.pdf")).toBeInTheDocument();
    expect(screen.getByText(/1.2 KB/i)).toBeInTheDocument();
  });
});
