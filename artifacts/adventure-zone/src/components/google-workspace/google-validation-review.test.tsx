import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleWorkspaceValidationReview: vi.fn(),
  getGoogleWorkspaceValidationReviewThread: vi.fn(),
  getGoogleWorkspaceValidationReviewAttachment: vi.fn(),
  runGoogleWorkspaceRecentValidation: vi.fn(),
  resolveGoogleWorkspaceValidationReview: vi.fn(),
  ignoreGoogleWorkspaceValidationReview: vi.fn(),
  retryGoogleWorkspaceGmailMutation: vi.fn(),
  getGoogleProfileLabelCleanupPreview: vi.fn(),
  deleteGoogleProfileLabels: vi.fn(),
}));
const search = vi.hoisted(() => ({
  searchGoogleReviewProfiles: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);
vi.mock("@/features/google-workspace/google-review-profile-search", () => search);

import { GoogleValidationReview } from "./google-validation-review";

const item = {
  messageId: "m1",
  threadId: "t1",
  subject: "County Fair application",
  from: "events@example.org",
  to: "zone@example.com",
  internalDateMs: 1,
  evidenceCodes: ["exact_profile_name_text"],
  candidates: [{ id: "11111111-1111-4111-8111-111111111111", name: "County Fair" }],
  hasAttachments: true,
  state: "pending" as const,
  resolvedOrganizationId: null,
  gmailSyncState: "not_requested" as const,
  gmailSyncErrorCode: null,
  gmailSyncMutationId: null,
};

beforeEach(() => {
  client.runGoogleWorkspaceRecentValidation.mockResolvedValue({});
  client.getGoogleWorkspaceValidationReview.mockResolvedValue({ items: [item] });
  client.getGoogleWorkspaceValidationReviewThread.mockResolvedValue({
    id: "t1",
    subject: "County Fair application",
    originalGmailUrl: "https://mail.google.com/mail/u/0/#all/t1",
    messages: [{
      id: "gm1",
      internalDateMs: 1,
      from: "events@example.org",
      to: "zone@example.com",
      cc: "",
      subject: "County Fair application",
      date: "Mon, 24 Aug 2026 10:00:00 -0600",
      direction: "incoming",
      bodyText: "We would like information about bringing Adventure Zone to our fair.",
      attachments: [{
        attachmentId: "a1",
        filename: "fair-info.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
        messageId: "gm1",
      }],
    }],
  });
  client.getGoogleWorkspaceValidationReviewAttachment.mockResolvedValue(
    new Blob(["pdf"], { type: "application/pdf" }),
  );
  client.resolveGoogleWorkspaceValidationReview.mockResolvedValue({
    ok: true,
    gmailSync: {
      mutationId: "33333333-3333-4333-8333-333333333333",
      state: "completed",
      gmailLabelId: "Label_1",
      gmailLabelName: "Z - AdventureZone/Profiles/County Fair",
      errorCode: null,
    },
  });
  client.ignoreGoogleWorkspaceValidationReview.mockResolvedValue({ ok: true });
  client.getGoogleProfileLabelCleanupPreview.mockResolvedValue({
    labels: [
      {
        id: "Label_old",
        name: "Z - AdventureZone/Profiles/Old County Fair",
      },
    ],
  });
  client.deleteGoogleProfileLabels.mockResolvedValue({
    deleted: [
      {
        id: "Label_old",
        name: "Z - AdventureZone/Profiles/Old County Fair",
      },
    ],
    skippedLabelIds: [],
    failed: [],
  });
  search.searchGoogleReviewProfiles.mockResolvedValue([
    { id: "22222222-2222-4222-8222-222222222222", name: "Another Fair" },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GoogleValidationReview", () => {
  it("opens a reviewed email attachment from inside the app", async () => {
    let resolveAttachment!: (blob: Blob) => void;
    client.getGoogleWorkspaceValidationReviewAttachment.mockReturnValue(
      new Promise<Blob>((resolve) => { resolveAttachment = resolve; }),
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:https://app.example/fair-info",
    );
    const popup = { close: vi.fn(), location: { href: "" }, opener: window };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    render(<GoogleValidationReview />);

    fireEvent.click(await screen.findByRole("button", {
      name: "View email: County Fair application",
    }));
    fireEvent.click(await screen.findByRole("button", {
      name: "Open attachment: fair-info.pdf",
    }));

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(popup.opener).toBeNull();
    await waitFor(() =>
      expect(client.getGoogleWorkspaceValidationReviewAttachment).toHaveBeenCalledWith(
        "m1",
        "gm1",
        "a1",
      ),
    );
    resolveAttachment(new Blob(["pdf"], { type: "application/pdf" }));
    await waitFor(() => expect(popup.location.href).toBe(
      "blob:https://app.example/fair-info",
    ));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("opens the full pending email inside Email Review", async () => {
    render(<GoogleValidationReview />);

    fireEvent.click(await screen.findByRole("button", {
      name: "View email: County Fair application",
    }));

    expect(await screen.findByText(
      "We would like information about bringing Adventure Zone to our fair.",
    )).toBeInTheDocument();
    expect(client.getGoogleWorkspaceValidationReviewThread).toHaveBeenCalledWith("m1");
    expect(screen.getByRole("button", {
      name: "Hide email: County Fair application",
    })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Open in Gmail" })).toHaveAttribute(
      "href",
      "https://mail.google.com/mail/u/0/#all/t1",
    );
  });

  it("checks recent Gmail before loading the review queue when opted in", async () => {
    render(<GoogleValidationReview checkGmailOnMount />);

    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    expect(client.runGoogleWorkspaceRecentValidation).toHaveBeenCalledWith(100);
  });

  it("shows Gmail-checking progress during the opening scan", async () => {
    let finishCheck!: () => void;
    client.runGoogleWorkspaceRecentValidation.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCheck = () => resolve({});
      }),
    );

    render(<GoogleValidationReview checkGmailOnMount />);

    expect(screen.getByText("Checking Gmail…")).toBeInTheDocument();
    finishCheck();
    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
  });

  it("lets the owner check Gmail again when opted in", async () => {
    render(<GoogleValidationReview checkGmailOnMount />);
    await screen.findByText("County Fair application");
    client.runGoogleWorkspaceRecentValidation.mockClear();
    client.getGoogleWorkspaceValidationReview.mockClear();

    let finishCheck!: () => void;
    client.runGoogleWorkspaceRecentValidation.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCheck = () => resolve({});
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check emails" }));

    const checkingButton = screen.getByRole("button", { name: "Checking Gmail…" });
    expect(checkingButton).toBeDisabled();
    await waitFor(() =>
      expect(client.runGoogleWorkspaceRecentValidation).toHaveBeenCalledWith(100),
    );
    finishCheck();
    await waitFor(() =>
      expect(client.getGoogleWorkspaceValidationReview).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByRole("button", { name: "Check emails" })).toBeEnabled();
  });

  it("previews, selects, confirms, and deletes old labels without touching email", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GoogleValidationReview checkGmailOnMount />);
    await screen.findByText("County Fair application");

    fireEvent.click(screen.getByRole("button", { name: "Clean up old labels" }));

    const oldLabel = await screen.findByRole("checkbox", {
      name: "Z - AdventureZone/Profiles/Old County Fair",
    });
    expect(client.deleteGoogleProfileLabels).not.toHaveBeenCalled();
    fireEvent.click(oldLabel);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete 1 selected label" }),
    );

    await waitFor(() =>
      expect(client.deleteGoogleProfileLabels).toHaveBeenCalledWith([
        "Label_old",
      ]),
    );
    expect(confirm).toHaveBeenCalled();
    expect(
      await screen.findByText("Deleted 1 old Gmail label. No emails were deleted."),
    ).toBeInTheDocument();
  });

  it("keeps failed cleanup labels selected and reports partial results", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    client.getGoogleProfileLabelCleanupPreview.mockResolvedValueOnce({
      labels: [
        {
          id: "Label_good",
          name: "Z - AdventureZone/Profiles/Old Good",
        },
        {
          id: "Label_bad",
          name: "Z - AdventureZone/Profiles/Old Bad",
        },
      ],
    });
    client.deleteGoogleProfileLabels.mockResolvedValueOnce({
      deleted: [
        {
          id: "Label_good",
          name: "Z - AdventureZone/Profiles/Old Good",
        },
      ],
      skippedLabelIds: [],
      failed: [
        {
          id: "Label_bad",
          name: "Z - AdventureZone/Profiles/Old Bad",
          errorCode: "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED",
        },
      ],
    });
    render(<GoogleValidationReview checkGmailOnMount />);
    await screen.findByText("County Fair application");

    fireEvent.click(screen.getByRole("button", { name: "Clean up old labels" }));
    const good = await screen.findByRole("checkbox", {
      name: "Z - AdventureZone/Profiles/Old Good",
    });
    const bad = screen.getByRole("checkbox", {
      name: "Z - AdventureZone/Profiles/Old Bad",
    });
    fireEvent.click(good);
    fireEvent.click(bad);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete 2 selected labels" }),
    );

    expect(
      await screen.findByText(
        "Deleted 1 old Gmail label. No emails were deleted. 1 label could not be deleted and remain selected.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: "Z - AdventureZone/Profiles/Old Good",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Z - AdventureZone/Profiles/Old Bad",
      }),
    ).toBeChecked();
  });

  it("loads only the saved queue in shared views", async () => {
    render(<GoogleValidationReview />);

    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    expect(client.runGoogleWorkspaceRecentValidation).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Check emails" })).not.toBeInTheDocument();
  });

  it("loads the saved queue when Gmail checking fails", async () => {
    client.runGoogleWorkspaceRecentValidation.mockRejectedValueOnce(
      new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"),
    );

    render(<GoogleValidationReview checkGmailOnMount />);

    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not check Gmail. Showing saved email review items.",
    );
  });

  it("shows pending items and lets the owner use a suggested profile", async () => {
    render(<GoogleValidationReview />);

    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assign to County Fair" }));

    await waitFor(() =>
      expect(client.resolveGoogleWorkspaceValidationReview).toHaveBeenCalledWith(
        "m1",
        "11111111-1111-4111-8111-111111111111",
      ),
    );
    expect(await screen.findByText("Assigned to the profile and archived in Gmail."))
      .toBeInTheDocument();
  });

  it("can search for a different profile and assign it", async () => {
    render(<GoogleValidationReview />);
    await screen.findByText("County Fair application");

    fireEvent.change(screen.getByLabelText("Search profiles for County Fair application"), {
      target: { value: "another" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));

    expect(await screen.findByText("Another Fair")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assign to Another Fair" }));
    await waitFor(() =>
      expect(client.resolveGoogleWorkspaceValidationReview).toHaveBeenCalledWith(
        "m1",
        "22222222-2222-4222-8222-222222222222",
      ),
    );
  });

  it("can explicitly ignore an irrelevant review item", async () => {
    render(<GoogleValidationReview />);
    await screen.findByText("County Fair application");
    fireEvent.click(screen.getByRole("button", { name: "Ignore this email" }));
    await waitFor(() =>
      expect(client.ignoreGoogleWorkspaceValidationReview).toHaveBeenCalledWith("m1"),
    );
    expect(await screen.findByText(
      "Ignored in Email Review. Gmail was left unchanged and the thread stays in Inbox.",
    )).toBeInTheDocument();
  });

  it("offers an immediate retry when Gmail synchronization is retryable", async () => {
    client.resolveGoogleWorkspaceValidationReview.mockResolvedValueOnce({
      ok: true,
      gmailSync: {
        mutationId: "33333333-3333-4333-8333-333333333333",
        state: "retryable_error",
        gmailLabelId: null,
        gmailLabelName: null,
        errorCode: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
      },
    });
    client.retryGoogleWorkspaceGmailMutation.mockResolvedValueOnce({
      ok: true,
      gmailSync: {
        mutationId: "33333333-3333-4333-8333-333333333333",
        state: "completed",
        gmailLabelId: "Label_1",
        gmailLabelName: "Z - AdventureZone/Profiles/County Fair",
        errorCode: null,
      },
    });
    render(<GoogleValidationReview />);
    await screen.findByText("County Fair application");

    fireEvent.click(screen.getByRole("button", { name: "Assign to County Fair" }));
    expect(await screen.findByText(
      "Profile assigned. Reconnect the company Google account in Settings, then retry Gmail.",
    )).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry Gmail" }));

    await waitFor(() => expect(client.retryGoogleWorkspaceGmailMutation)
      .toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333"));
    expect(await screen.findByText("Assigned to the profile and archived in Gmail."))
      .toBeInTheDocument();
  });
});
