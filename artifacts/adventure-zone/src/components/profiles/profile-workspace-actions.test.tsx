import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProfileWorkspaceActions } from "./profile-workspace-actions";
it("exposes the four daily actions without a menu", () => {
  const follow = vi.fn(),
    emails = vi.fn(),
    note = vi.fn(),
    assistant = vi.fn();
  render(
    <ProfileWorkspaceActions
      onFollowUp={follow}
      onOpenEmails={emails}
      onAddNote={note}
      onAssistant={assistant}
    />,
  );
  for (const [name, callback] of [
    ["Follow up", follow],
    ["Open emails", emails],
    ["Add note", note],
    ["Assistant", assistant],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(callback).toHaveBeenCalledOnce();
  }
});
