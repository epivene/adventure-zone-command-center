import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailReviewPage } from "./EmailReviewPage";

const getReview = vi.fn();
const runRecentValidation = vi.fn();

vi.mock("@/features/google-workspace/google-workspace-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/google-workspace/google-workspace-client")>();
  return {
    ...actual,
    getGoogleWorkspaceValidationReview: () => getReview(),
    runGoogleWorkspaceRecentValidation: (limit: number) => runRecentValidation(limit),
  };
});

function reviewItem(input: {
  messageId: string;
  subject: string;
  state: "pending" | "resolved" | "ignored";
}) {
  return {
    messageId: input.messageId,
    threadId: `thread-${input.messageId}`,
    subject: input.subject,
    from: "fair@example.org",
    to: "zone@example.com",
    internalDateMs: 1,
    evidenceCodes: [],
    candidates: [],
    hasAttachments: false,
    state: input.state,
    resolvedOrganizationId: input.state === "resolved" ? "org-1" : null,
  };
}

describe("EmailReviewPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    runRecentValidation.mockReset();
    runRecentValidation.mockResolvedValue({});
    getReview.mockReset();
    getReview.mockResolvedValue({
      items: [
        reviewItem({ messageId: "pending", subject: "County Fair application", state: "pending" }),
        reviewItem({ messageId: "resolved", subject: "Resolved festival", state: "resolved" }),
        reviewItem({ messageId: "ignored", subject: "Ignored promotion", state: "ignored" }),
      ],
    });
  });

  it("opens the durable review queue without scanning Gmail automatically", async () => {
    render(<EmailReviewPage />);

    expect(screen.getByRole("heading", { name: "Email Review" })).toBeInTheDocument();
    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    expect(runRecentValidation).not.toHaveBeenCalled();
    expect(screen.getByText("1 waiting for you")).toBeInTheDocument();
    expect(screen.queryByText("Resolved festival")).not.toBeInTheDocument();
  });

  it("lets the owner check Gmail again and refreshes the review queue", async () => {
    render(<EmailReviewPage />);
    await screen.findByText("County Fair application");
    runRecentValidation.mockClear();
    getReview.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Check emails" }));

    await waitFor(() => expect(runRecentValidation).toHaveBeenCalledWith(100));
    await waitFor(() => expect(getReview).toHaveBeenCalledTimes(1));
  });

  it("keeps showing the saved queue when a manual Gmail check fails", async () => {
    render(<EmailReviewPage />);
    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    runRecentValidation.mockRejectedValueOnce(
      new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Check emails" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check Gmail. Showing saved email review items.",
    );
    expect(screen.getByText("County Fair application")).toBeInTheDocument();
  });

  it("keeps resolved and ignored email available in a collapsible history", async () => {
    render(<EmailReviewPage />);
    await screen.findByText("County Fair application");

    fireEvent.click(screen.getByRole("button", { name: "Show review history" }));

    expect(screen.getByText("Resolved festival")).toBeInTheDocument();
    expect(screen.getByText("Ignored promotion")).toBeInTheDocument();
  });
});
