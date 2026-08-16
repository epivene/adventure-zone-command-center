// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerMessagesPage from "./ManagerMessagesPage";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string, options?: RequestInit) => {
    if (path === "/manager/messages/conversations/all" && options?.method === "POST") return { message: { id: "m2" } };
    if (path === "/manager/messages/conversations" && options?.method === "POST") return { conversation: { id: "new" } };
    if (path === "/manager/messages/conversations") return { conversations: [
      { id: "all", kind: "all_managers", title: "All Managers", unreadCount: 2 },
      { id: "leg", kind: "leg_admin", title: "Kristy + Admin", unreadCount: 0 },
    ] };
    if (path === "/manager/messages/conversations/all") return { messages: [
      { id: "m1", actorKind: "manager", actorName: "Hulk", body: "Where are you headed next?", attachments: [] },
    ] };
    return {};
  }),
  legs: vi.fn(async () => [{ id: "leg-b", name: "Hulk" }, { id: "leg-a", name: "Kristy" }]),
}));
vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legId: "leg-a", legName: "Kristy", managerName: "Kristy" }, managerApi: mocks.api }),
  listManagerLoginLegs: mocks.legs,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ManagerMessagesPage", () => {
  it("keeps the main messaging experience simple and clearly admin-visible", async () => {
    render(<ManagerMessagesPage />);
    expect(await screen.findByText("All Managers")).toBeInTheDocument();
    expect(screen.getByText("2 unread")).toBeInTheDocument();
    expect(screen.getByText(/Messages in this app are visible to admins/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New message" })).toBeInTheDocument();
  });

  it("opens a conversation and sends a normal message", async () => {
    render(<ManagerMessagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /All Managers/i }));
    expect(await screen.findByText("Where are you headed next?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "North tomorrow" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(
      "/manager/messages/conversations/all",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("creates a direct/group conversation without exposing system jargon", async () => {
    render(<ManagerMessagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New message" }));
    expect(await screen.findByText("Hulk")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Hulk"));
    fireEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(
      "/manager/messages/conversations",
      expect.objectContaining({ method: "POST" }),
    ));
  });
});
