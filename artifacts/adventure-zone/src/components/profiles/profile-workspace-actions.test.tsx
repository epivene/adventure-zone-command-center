// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileWorkspaceActions } from "./profile-workspace-actions";

afterEach(cleanup);

it("keeps follow-up as the single prominent workspace action", () => {
  const follow = vi.fn();
  render(
    <ProfileWorkspaceActions onFollowUp={follow} />,
  );
  expect(screen.getByRole("button", { name: "Follow up" })).toBeInTheDocument();
  expect(screen.getByTestId("profile-action-follow-up")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Follow up" }));
  expect(follow).toHaveBeenCalledOnce();
});

it("does not expose write actions in read-only profiles", () => {
  const follow = vi.fn();
  render(
    <ProfileWorkspaceActions readOnly onFollowUp={follow} />,
  );

  expect(screen.queryByRole("button", { name: "Follow up" })).not.toBeInTheDocument();
  expect(follow).not.toHaveBeenCalled();
});
