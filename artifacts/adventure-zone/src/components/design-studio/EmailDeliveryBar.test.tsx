import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { designStudioApi } from "@/lib/design-studio-api";
import { EmailDeliveryBar } from "./EmailDeliveryBar";

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const project = {
  id: "project-1",
  name: "Wyoming State Fair outreach",
  type: "email" as const,
  linkedOrganizationId: "organization-1",
  linkedContactId: "contact-1",
};

const appDraft = {
  id: "draft-1",
  state: "draft" as const,
  recipientEmail: "gm@example.com",
  subject: project.name,
  scheduledFor: null,
  businessTimeZone: null,
  gmailDraftId: null,
  gmailMessageId: null,
  gmailThreadId: null,
  lastFailureCode: null,
  lastFailureMessage: null,
};

describe("EmailDeliveryBar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(designStudioApi, "emailStatus").mockResolvedValue({
      recipientEmail: "gm@example.com",
      draft: appDraft,
      gmailConnected: true,
      approvalRequired: true,
      approvalCurrent: false,
      approvedFingerprint: null,
    });
    vi.spyOn(designStudioApi, "saveEmailInApp").mockResolvedValue({
      draft: appDraft,
    });
    vi.spyOn(designStudioApi, "createGmailDraft").mockResolvedValue({
      draft: {
        ...appDraft,
        state: "gmail_draft",
        gmailDraftId: "gmail-draft-1",
      },
    });
    vi.spyOn(designStudioApi, "reviewEmailContent").mockResolvedValue({
      digest: "a".repeat(64),
      approvalCurrent: false,
    });
    vi.spyOn(designStudioApi, "approveEmailContent").mockResolvedValue({
      digest: "a".repeat(64),
    });
  });

  it("shows the profile recipient and gates delivery until exact review", async () => {
    render(
      <EmailDeliveryBar
        dirty={false}
        project={project}
        save={vi.fn().mockResolvedValue(true)}
        saving={false}
      />,
    );
    expect(await screen.findByText("gm@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save in app" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Create Gmail Draft" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send Now" })).toBeDisabled();
  });

  it("awaits the editor save before creating a real Gmail draft", async () => {
    const order: string[] = [];
    const save = vi.fn(async () => {
      order.push("save");
      return true;
    });
    vi.mocked(designStudioApi.createGmailDraft).mockImplementation(async () => {
      order.push("gmail");
      return {
        draft: {
          ...appDraft,
          state: "gmail_draft",
          gmailDraftId: "gmail-draft-1",
        },
      };
    });
    render(
      <EmailDeliveryBar
        dirty={false}
        project={project}
        save={save}
        saving={false}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Create Gmail Draft" }),
    );
    await screen.findByText(/saved to gmail drafts/i);
    expect(order).toEqual(["save", "gmail"]);
  });

  it("shows the missing-email state and disables commands", async () => {
    vi.mocked(designStudioApi.emailStatus).mockResolvedValue({
      recipientEmail: null,
      draft: null,
      gmailConnected: false,
      approvalRequired: true,
      approvalCurrent: false,
      approvedFingerprint: null,
    });
    render(
      <EmailDeliveryBar
        dirty={false}
        project={project}
        save={vi.fn()}
        saving={false}
      />,
    );
    expect(await screen.findByText("Add a contact email first")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save in app" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create Gmail Draft" }),
    ).toBeDisabled();
  });

  it("invalidates approval as soon as editor content becomes dirty", async () => {
    vi.mocked(designStudioApi.emailStatus).mockResolvedValue({
      recipientEmail: "gm@example.com",
      draft: appDraft,
      gmailConnected: true,
      approvalRequired: true,
      approvalCurrent: true,
      approvedFingerprint: "a".repeat(64),
    });
    const view = render(
      <EmailDeliveryBar
        dirty={false}
        project={project}
        save={vi.fn()}
        saving={false}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send Now" })).toBeEnabled(),
    );
    view.rerender(
      <EmailDeliveryBar
        dirty
        project={project}
        save={vi.fn()}
        saving={false}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send Now" })).toBeDisabled(),
    );
  });
});
