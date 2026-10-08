import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/features/assistant-workspace/api", () => ({
  workspaceApi: vi.fn(),
}));

import { workspaceApi } from "@/features/assistant-workspace/api";
import type { Draft } from "@/features/assistant-workspace/types";
import { SendReview } from "./SendReview";

afterEach(cleanup);

describe("SendReview", () => {
  it("opens the existing Today planner from a specific-offer review", async () => {
    vi.mocked(workspaceApi).mockResolvedValue({
      status: "ready",
      revision: "revision-1",
      digest: "digest-1",
      html: "<p>Reviewed email</p>",
      reviewReasons: [],
    });
    const draft = {
      id: "draft-1",
      revision: "revision-1",
      status: "draft",
      gmailDraftId: null,
      content: {
        to: ["venue@example.com"],
        cc: [],
        subject: "Event offer",
        html: "<p>Draft email</p>",
        text: "Draft email",
        threadId: null,
        attachmentIds: [],
        templateId: null,
        templateVersion: null,
      },
    } as Draft;

    render(<SendReview draft={draft} onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check current draft and offer" }));
    await waitFor(() => expect(workspaceApi).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText("Purpose"), { target: { value: "specific_offer" } });

    expect(screen.getByRole("link", { name: "Open Today’s Outreach Planner" }))
      .toHaveAttribute("href", "/today?section=outreach-planner");
  });
});
