import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { EmailAttentionControls } from "./email-attention-controls";
const mock = vi.hoisted(() => ({ saved: null as any, post: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({
  apiFetch: async (path: string, options?: any) => {
    if (options) mock.post(path, JSON.parse(options.body));
    return {
      ok: true,
      json: async () =>
        path.includes("/context?")
          ? mock.saved
          : path.endsWith("preview")
            ? {
                id: "preview",
                expectedRevision: null,
                subject: "Verified fair question",
                profileId: "profile",
                eventYear: null,
                state: "needs_your_reply",
              }
            : {
                gmailSync: { state: "retry_required" },
                archiveSync: { state: "complete" },
              },
    };
  },
}));
afterEach(() => {
  cleanup();
  mock.saved = null;
  mock.post.mockClear();
});
it("previews before filing and reports partial synchronization", async () => {
  render(<EmailAttentionControls messageId="message" profileId="profile" />);
  await waitFor(() =>
    expect(screen.queryByText("Loading saved conversation…")).toBeNull(),
  );
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Question needs reply" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview filing" }));
  expect(await screen.findByText("Verified fair question")).toBeTruthy();
  expect(screen.getByText(/Year unconfirmed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply filing" }));
  expect(await screen.findByText(/Gmail: needs retry/)).toBeTruthy();
});
it("retains the saved waiting decision and linked reminder when reopening", async () => {
  mock.saved = {
    profileId: "profile",
    state: "waiting_for_their_reply",
    eventYear: 2027,
    reason: "Awaiting date",
    dueAt: "2026-10-09T16:00:00Z",
    followupId: "reminder",
  };
  render(<EmailAttentionControls messageId="message" profileId="profile" />);
  await waitFor(() =>
    expect(screen.getByLabelText("Conversation status")).toHaveValue(
      "waiting_for_their_reply",
    ),
  );
  expect(screen.getByLabelText(/Event year/)).toHaveValue(2027);
  fireEvent.click(screen.getByRole("button", { name: "Preview filing" }));
  await screen.findByText("Verified fair question");
  expect(mock.post).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      state: "waiting_for_their_reply",
      eventYear: 2027,
      dueAt: mock.saved.dueAt,
      followupId: "reminder",
    }),
  );
});
