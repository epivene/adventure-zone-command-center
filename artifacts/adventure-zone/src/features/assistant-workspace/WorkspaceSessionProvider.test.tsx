import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";
import { Router, Link } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  WorkspaceSessionProvider,
  useWorkspaceSession,
} from "./LegacyWorkspaceSessionProvider";
import { workspaceApi } from "./api";
import { spendingSummary } from "@/test/assistant-spending";
vi.mock("./api", () => ({
  workspaceApi: vi.fn(),
  lastConversationKey: "session-test",
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});
function Profile() {
  const session = useWorkspaceSession();
  return (
    <button
      onClick={() =>
        void session.openProfile(
          "11111111-1111-4111-8111-111111111111",
          "County Fair",
        )
      }
    >
      Ask about profile
    </button>
  );
}
it("keeps the composer and profile scope when expanding and returning", async () => {
  vi.mocked(workspaceApi).mockImplementation(async (path) => {
    if (path === "/status")
      return {
        ready: true,
        models: ["model"],
        model: "model",
        checks: [],
      } as any;
    if (path === "/spending") return spendingSummary as any;
    return [] as any;
  });
  const route = memoryLocation({
    path: "/profiles/11111111-1111-4111-8111-111111111111",
    record: true,
  });
  render(
    <Router hook={route.hook}>
      <WorkspaceSessionProvider>
        <Profile />
      </WorkspaceSessionProvider>
    </Router>,
  );
  fireEvent.click(screen.getByText("Ask about profile"));
  const composer = await screen.findByLabelText("Message the assistant");
  fireEvent.change(composer, {
    target: { value: "Do they need a follow-up?" },
  });
  expect(screen.getByText(/Working with: County Fair/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open full workspace" }));
  await waitFor(() =>
    expect(route.history.at(-1)).toBe("/assistant/workspace"),
  );
  expect(screen.getByLabelText("Message the assistant")).toHaveValue(
    "Do they need a follow-up?",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
  expect(screen.getByLabelText("Message the assistant")).toHaveValue(
    "Do they need a follow-up?",
  );
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.filter(([, method]) => method === "POST"),
  ).toHaveLength(0);
});

it("places the full workspace below the actual app header height", async () => {
  vi.mocked(workspaceApi).mockResolvedValue([] as any);
  const route = memoryLocation({ path: "/assistant/workspace" });
  render(
    <Router hook={route.hook}>
      <WorkspaceSessionProvider>
        <header data-assistant-shell-header style={{ height: 124 }} />
      </WorkspaceSessionProvider>
    </Router>,
  );
  const workspace = document.querySelector<HTMLElement>("[data-assistant-workspace-host]");
  expect(workspace).toBeInTheDocument();
  await waitFor(() =>
    expect(workspace?.style.getPropertyValue("--assistant-header-height")).toBe("124px"),
  );
  const header = document.querySelector<HTMLElement>("[data-assistant-shell-header]")!;
  header.style.height = "166px";
  window.dispatchEvent(new Event("resize"));
  await waitFor(() =>
    expect(workspace?.style.getPropertyValue("--assistant-header-height")).toBe("166px"),
  );
});

it("closes the profile panel with Escape and restores focus", async () => {
  vi.mocked(workspaceApi).mockResolvedValue([] as any);
  const route = memoryLocation({ path: "/profiles/p1" });
  render(
    <Router hook={route.hook}>
      <WorkspaceSessionProvider>
        <Profile />
      </WorkspaceSessionProvider>
    </Router>,
  );
  const opener = screen.getByText("Ask about profile");
  opener.focus();
  fireEvent.click(opener);
  const close = await screen.findByRole("button", { name: "Close assistant" });
  close.focus();
  fireEvent.keyDown(close, { key: "Escape" });
  expect(
    screen.queryByRole("dialog", { name: "Assistant" }),
  ).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("reuses a route-opened conversation when its associated profile opens Assistant", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  sessionStorage.setItem(
    "az-assistant-profile-sessions",
    JSON.stringify({ [id]: "saved-chat" }),
  );
  vi.mocked(workspaceApi).mockImplementation(async (path) => {
    if (path === "/status")
      return {
        ready: true,
        models: ["model"],
        model: "model",
        checks: [],
      } as any;
    if (path === "/spending") return spendingSummary as any;
    if (path === "/conversations/saved-chat")
      return {
        id: "saved-chat",
        title: "Saved chat",
        version: 1,
        lifecycle: "active",
        selection: {
          organizationIds: [id],
          bookingId: null,
          threadId: null,
          draftId: null,
          eventYear: null,
        },
        messages: [],
        drafts: [],
        actions: [],
        runs: [],
      } as any;
    return [] as any;
  });
  const route = memoryLocation({ path: "/assistant/workspace/saved-chat" });
  render(
    <Router hook={route.hook}>
      <WorkspaceSessionProvider>
        <Link href={`/profiles/${id}`}>Open profile</Link>
        <Profile />
      </WorkspaceSessionProvider>
    </Router>,
  );
  const composer = await screen.findByLabelText("Message the assistant");
  fireEvent.change(composer, { target: { value: "Keep my unsent question" } });
  fireEvent.click(screen.getByText("Open profile"));
  fireEvent.click(screen.getByText("Ask about profile"));
  await screen.findByRole("button", { name: "Close assistant" });
  const restored = await screen.findByRole("textbox", {
    name: "Message the assistant",
  });
  expect(restored).toBe(composer);
  expect(screen.getAllByLabelText("Message the assistant")).toHaveLength(1);
  expect(screen.getByLabelText("Message the assistant")).toHaveValue(
    "Keep my unsent question",
  );
});
