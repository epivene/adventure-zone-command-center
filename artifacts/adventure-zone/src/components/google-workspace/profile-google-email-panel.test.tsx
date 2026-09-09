import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleProfileEmails: vi.fn(),
  getGoogleProfileEmailThread: vi.fn(),
  copyGoogleProfileThreadFiles: vi.fn(),
  getGoogleProfileFiles: vi.fn(),
  openGoogleProfileFile: vi.fn(),
  replyToGoogleProfileEmail: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);

import { ProfileGoogleEmailPanel } from "./profile-google-email-panel";

const storedFile = {
  id: "file-1",
  organizationId: "org-1",
  threadId: "thread-1",
  messageId: "m1",
  attachmentId: "a1",
  filename: "application.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1200,
  contentSha256: "abc",
  storageObjectKey: "google-workspace/attachments/ab/abc",
  availability: "available" as const,
  lastErrorCode: null,
  createdAt: "2026-08-24T18:00:00.000Z",
};

function conversation(threadId: string, year: number) {
  return {
    threadId,
    subject: `${year} Twin Falls County Fair ${threadId}`,
    from: "Adventure Zone <theadventurezone12@gmail.com>",
    to: "fair@tfcfair.com",
    date: `${year}-08-25`,
    internalDateMs: Date.UTC(year, 7, 25, 18, 0, 0),
    hasAttachments: false,
    contactId: null,
    evidenceCodes: ["exact_contact_email"],
    originalGmailUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
  };
}

beforeEach(() => {
  client.getGoogleProfileEmails.mockResolvedValue({
    validationSampleOnly: false,
    historicalBackfillIncluded: true,
    conversations: [
      {
        threadId: "thread-1",
        subject: "County Fair follow up",
        from: "fair@example.org",
        to: "zone@example.com",
        date: "Mon, 24 Aug 2026 10:00:00 -0600",
        internalDateMs: Date.UTC(2026, 7, 24, 16, 0, 0),
        hasAttachments: true,
        contactId: "contact-1",
        evidenceCodes: ["exact_contact_email", "contact_active_organization"],
        originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
      },
    ],
  });
  client.getGoogleProfileEmailThread.mockResolvedValue({
    id: "thread-1",
    conversationId: "conversation-1",
    savedCopy: true,
    archiveState: "complete",
    sourceState: "synced",
    subject: "County Fair follow up",
    originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
    messages: [
      {
        id: "m1",
        internalDateMs: Date.UTC(2026, 7, 24, 16, 0, 0),
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
  client.replyToGoogleProfileEmail.mockResolvedValue({
    id: "thread-new",
    conversationId: "conversation-1",
    savedCopy: true,
    archiveState: "complete",
    sourceState: "synced",
    subject: "County Fair follow up",
    originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-new",
    messages: [{
      id: "message-new",
      internalDateMs: Date.UTC(2026, 7, 24, 17, 0, 0),
      from: "zone@example.com",
      to: "fair@example.org",
      cc: "",
      subject: "Re: County Fair follow up",
      date: "",
      direction: "outgoing",
      bodyText: "We are available.",
      attachments: [],
    }],
  });
  client.getGoogleProfileFiles.mockResolvedValue({ files: [] });
  client.copyGoogleProfileThreadFiles.mockResolvedValue({ files: [storedFile] });
  client.openGoogleProfileFile.mockResolvedValue({
    url: "https://signed.example/application.pdf",
    expiresInSeconds: 900,
  });
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileGoogleEmailPanel", () => {
  it("gives matched historical Gmail conversations separate Emails and Files views", async () => {
    render(<ProfileGoogleEmailPanel organizationId="org-1" />);

    expect(await screen.findByRole("heading", { name: "Google history" })).toBeInTheDocument();
    expect(screen.getByText(/saved in the app automatically/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emails" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(await screen.findByText("County Fair follow up")).toBeInTheDocument();
  });

  it("shows current-year conversations separately from earlier Gmail history", async () => {
    const currentYear = new Date().getUTCFullYear();
    const current = [1, 2, 3, 4].map((n) => conversation(`current-${n}`, currentYear));
    const earlier = [1, 2, 3, 4, 5].map((n) => conversation(`history-${n}`, currentYear - n));
    client.getGoogleProfileEmails.mockResolvedValue({
      validationSampleOnly: false,
      historicalBackfillIncluded: true,
      liveGmail: true,
      unavailableThreadCount: 0,
      conversations: [...current, ...earlier],
    });

    render(<ProfileGoogleEmailPanel organizationId="org-1" />);

    expect(await screen.findByText(`${currentYear} emails (4)`)).toBeInTheDocument();
    expect(screen.getByText("Earlier Gmail history (5)")).toBeInTheDocument();
    expect(screen.getByText(`${currentYear} Twin Falls County Fair current-4`)).toBeInTheDocument();
  });

  it("opens the complete readable thread and lets attachments be saved to Files", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Save attachments to Files" }));
    await waitFor(() =>
      expect(client.copyGoogleProfileThreadFiles).toHaveBeenCalledWith(
        "org-1",
        "thread-1",
      ),
    );
  });

  it("shows a deleted Gmail thread as saved and sends a reply from the app", async () => {
    client.getGoogleProfileEmailThread.mockResolvedValueOnce({
      ...(await client.getGoogleProfileEmailThread.getMockImplementation()!()),
      id: "thread-1",
      conversationId: "conversation-1",
      savedCopy: true,
      archiveState: "complete",
      sourceState: "saved_copy_gmail_missing",
      subject: "County Fair follow up",
      originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
      messages: [{
        id: "m1",
        internalDateMs: 1,
        from: "fair@example.org",
        to: "zone@example.com",
        cc: "",
        subject: "County Fair follow up",
        date: "",
        direction: "incoming",
        bodyText: "Saved body",
        attachments: [],
      }],
    });
    render(<ProfileGoogleEmailPanel organizationId="org-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /County Fair follow up/i }));
    expect(
      await screen.findByText("Saved in app; no longer in Gmail"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Open in Gmail")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Reply from the app"), {
      target: { value: "We are available." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() =>
      expect(client.replyToGoogleProfileEmail).toHaveBeenCalledWith(
        "org-1",
        "conversation-1",
        "We are available.",
      ),
    );
    expect(screen.getByLabelText("Reply from the app")).toHaveValue("");
  });

  it("lists durable profile files and opens them through a signed URL", async () => {
    client.getGoogleProfileFiles.mockResolvedValue({ files: [storedFile] });
    render(<ProfileGoogleEmailPanel organizationId="org-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Files" }));
    expect(await screen.findByText("application.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));

    await waitFor(() =>
      expect(client.openGoogleProfileFile).toHaveBeenCalledWith("org-1", "file-1"),
    );
    expect(window.open).toHaveBeenCalledWith(
      "https://signed.example/application.pdf",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
