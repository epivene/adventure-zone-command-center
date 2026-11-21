import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { WorkspaceSessionProvider, useWorkspaceSession } from "./WorkspaceSessionProvider";
import { workspaceApi } from "./api";
vi.mock("./api", () => ({ workspaceApi: vi.fn(), lastConversationKey: "test" }));
function ProfileAction() {
  const session = useWorkspaceSession();
  return <button onClick={() => void session.openProfile("profile-id")}>Open connection</button>;
}
it("routes existing profile actions to ChatGPT without starting internal AI", () => {
  const route = memoryLocation({ path: "/profiles/profile-id", record: true });
  render(<Router hook={route.hook}><WorkspaceSessionProvider><ProfileAction /></WorkspaceSessionProvider></Router>);
  fireEvent.click(screen.getByRole("button", { name: "Open connection" }));
  expect(route.history.at(-1)).toBe("/settings/chatgpt-connection");
  expect(workspaceApi).not.toHaveBeenCalled();
});
