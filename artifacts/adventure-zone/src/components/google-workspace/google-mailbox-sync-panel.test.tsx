import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GoogleMailboxSyncPanel } from "./google-mailbox-sync-panel";
const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/auth-token", () => ({
  apiFetch: async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      json: async () =>
        url.includes("/thread?")
          ? {
              snapshot: { drafts: [{ id: "d", bodyText: "Current draft" }] },
              followups: [],
              ownerDecision: "Confirm dates",
            }
          : url.includes("/threads")
            ? {
                items: [
                  {
                    threadId: "t",
                    profileId: "p",
                    profileName: "Fair",
                    state: "draft_to_review",
                    draftCount: 1,
                  },
                ],
                nextCursor: "t",
              }
            : { mode: "active", pending: 20, blocked: 0 },
    };
  },
}));
afterEach(() => {
  cleanup();
  calls.length = 0;
});
it("loads cached pages and fetches draft text only when details are requested", async () => {
  render(<GoogleMailboxSyncPanel />);
  expect(await screen.findByText("Fair")).toBeTruthy();
  expect(screen.queryByText("Current draft")).toBeNull();
  expect(calls.some((c) => c.includes("/thread?"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Review details" }));
  expect(await screen.findByText("Current draft")).toBeTruthy();
  expect(screen.getByText("Confirm dates")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(calls.some((c) => c.includes("cursor=t"))).toBe(true);
});
