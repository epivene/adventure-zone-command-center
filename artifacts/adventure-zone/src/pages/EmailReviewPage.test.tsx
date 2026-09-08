import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("checks recent Gmail before opening the durable review queue", async () => {
    render(<EmailReviewPage />);

    expect(screen.getByRole("heading", { name: "Email Review" })).toBeInTheDocument();
    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    expect(runRecentValidation).toHaveBeenCalledWith(100);
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

  it("shows the saved queue when checking Gmail fails", async () => {
    runRecentValidation.mockRejectedValueOnce(new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"));

    render(<EmailReviewPage />);

    expect(await screen.findByText("County Fair application")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not check Gmail. Showing saved email review items.",
    );
  });

  it("keeps resolved and ignored email available in a collapsible history", async () => {
    render(<EmailReviewPage />);
    await screen.findByText("County Fair application");

    fireEvent.click(screen.getByRole("button", { name: "Show review history" }));

    expect(screen.getByText("Resolved festival")).toBeInTheDocument();
    expect(screen.getByText("Ignored promotion")).toBeInTheDocument();
  });
});
