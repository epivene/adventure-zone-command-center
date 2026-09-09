import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ bossGet: vi.fn() }));
vi.mock("@/lib/boss-auth-context", () => api);
import { BossProfileEmails } from "./boss-profile-emails";
const email = { threadId: "thread-1", subject: "Fair reply", from: "fair@example.org", date: "2026-09-09" };
beforeEach(() => {
  vi.clearAllMocks();
  api.bossGet.mockImplementation(async (path: string) => {
    if (path.endsWith("email-drafts")) return { drafts: [{ id: "draft-1", subject: "Upcoming fair", body: "Draft copy for Dave", recipientEmail: "fair@example.org", state: "draft" }] };
    if (path.endsWith("thread-1")) return { messages: [{ id: "message-1", from: "fair@example.org", to: "zone@example.org", bodyText: "We are interested!", attachments: [] }] };
    return { conversations: [email], historicalConversations: [{ ...email, threadId: "old-thread", subject: "Last year's fair" }], unavailableThreadCount: 0 };
  });
});
it("lets Dave read saved drafts, current conversations and earlier history without write controls", async () => {
  render(<BossProfileEmails organizationId="profile-1" />);
  expect(api.bossGet).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /View emails/ }));
  expect(await screen.findByText("Draft copy for Dave")).toBeInTheDocument();
  expect(screen.getByText(/Draft — not sent/)).toBeInTheDocument();
  expect(screen.getByText("Last year's fair")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Fair reply/ }));
  expect(await screen.findByText("We are interested!")).toBeInTheDocument();
  expect(api.bossGet).toHaveBeenCalledWith("/boss/google-workspace/profiles/profile-1/emails/thread-1");
  expect(screen.queryByRole("button", { name: /send|save|create/i })).toBeNull();
});
it("keeps saved drafts visible if Gmail is unavailable and provides retry", async () => {
  api.bossGet.mockImplementation(async (path: string) => {
    if (path.endsWith("email-drafts")) return { drafts: [{ id: "draft-1", subject: "Saved draft", body: "Still here", recipientEmail: "fair@example.org", state: "draft" }] };
    throw new Error("Unavailable");
  });
  render(<BossProfileEmails organizationId="profile-1" />);
  fireEvent.click(screen.getByRole("button", { name: /View emails/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load linked email conversations");
  expect(screen.getByText("Still here")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(api.bossGet).toHaveBeenCalledTimes(4);
});
