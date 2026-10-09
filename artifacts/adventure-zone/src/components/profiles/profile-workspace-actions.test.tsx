// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileWorkspaceActions } from "./profile-workspace-actions";

afterEach(cleanup);

it("keeps follow-up prominent and groups the other frequent actions", async () => {
  const follow = vi.fn(), emails = vi.fn(), assistant = vi.fn();
  const user = userEvent.setup();
  render(
    <ProfileWorkspaceActions
      onFollowUp={follow}
      onOpenEmails={emails}
      onAssistant={assistant}
    />,
  );
  expect(screen.getByRole("button", { name: "Follow up" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
  expect(screen.getByTestId("profile-actions")).toHaveClass("flex-wrap");
  expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Follow up" }));
  expect(follow).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Open emails" }));
  expect(emails).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Assistant" }));
  expect(assistant).toHaveBeenCalledOnce();
});

it("keeps email history available in read-only profiles without exposing write actions", async () => {
  const follow = vi.fn(), emails = vi.fn(), assistant = vi.fn();
  const user = userEvent.setup();
  render(
    <ProfileWorkspaceActions
      readOnly
      emailCount={3}
      onFollowUp={follow}
      onOpenEmails={emails}
      onAssistant={assistant}
    />,
  );

  expect(screen.queryByRole("button", { name: "Follow up" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: "3 Emails" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Assistant" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "3 Emails" }));
  expect(emails).toHaveBeenCalledOnce();
  expect(follow).not.toHaveBeenCalled();
  expect(assistant).not.toHaveBeenCalled();
});
