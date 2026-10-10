// @vitest-environment jsdom
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileLatestEmail } from "./profile-latest-email";
import { useProfileGoogleEmail, type ProfileGoogleEmailState } from "@/components/google-workspace/use-profile-google-email";
import type { GoogleProfileEmailConversation } from "@/features/google-workspace/google-workspace-client";
import { readEmailWorkspaceState, mailboxRestoreTarget } from "@/features/emails/email-workspace-state";

const mocks = vi.hoisted(() => ({ thread: vi.fn(), emails: vi.fn() }));
vi.mock("@/features/google-workspace/google-workspace-client", () => ({
  getGoogleProfileEmailThread: mocks.thread, getGoogleProfileEmails: mocks.emails,
}));
const email = (threadId: string, date: string): GoogleProfileEmailConversation => ({
  threadId, date, internalDateMs: Date.parse(date), subject: `Subject ${threadId}`,
  from: "Organizer <organizer@example.org>", to: "Adventure Zone <office@example.org>",
  hasAttachments: false, contactId: null, evidenceCodes: [], originalGmailUrl: "",
});
const state = (conversations: GoogleProfileEmailConversation[], overrides: Partial<ProfileGoogleEmailState> = {}): ProfileGoogleEmailState => ({
  conversations, current: [], historical: [], loading: false, error: null, reload: vi.fn(), ...overrides,
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("latest profile email", () => {
  it("shows the newest linked email and the latest message preview, regardless of input order", async () => {
    mocks.thread.mockResolvedValue({ messages: [
      { date: "2026-01-01", bodyText: "Old message" },
      { date: "2026-10-08", bodyText: "Our committee is ready to discuss next year's booking." },
    ] });
    render(<ProfileLatestEmail profileId="profile-1" gmail={state([email("old", "2025-10-01"), email("latest", "2026-10-08")])} />);
    await screen.findByText("Our committee is ready to discuss next year's booking.");
    expect(screen.getByText("Subject latest")).toBeInTheDocument();
    expect(screen.queryByText("Old message")).not.toBeInTheDocument();
    expect(mocks.thread).toHaveBeenCalledWith("profile-1", "latest");
    expect(screen.getByRole("link", { name: "Open email" })).toHaveAttribute("href", "/emails?profileId=profile-1&threadId=latest");
  });
  it("links to the specific conversation even when it is absent from the inbox's first page", async () => {
    mocks.thread.mockResolvedValue({ messages: [] });
    render(<ProfileLatestEmail profileId="profile & one" gmail={state([email("thread/123", "2026-10-08")])} />);
    const url = new URL(screen.getByRole("link", { name: "Open email" }).getAttribute("href")!, "https://example.org");
    const restored = mailboxRestoreTarget(readEmailWorkspaceState(url.search), [], "connected-account");
    expect(restored).toMatchObject({ threadId: "thread/123", profiles: [{ id: "profile & one" }] });
    await screen.findByText(/No text preview available/);
  });
  it("shows the latest email as a compact row with a direct conversation link", async () => {
    mocks.thread.mockResolvedValue({ messages: [{ subject: "Subject latest", to: "Office <office@example.org>", bodyText: "A short preview" }] });
    render(<ProfileLatestEmail profileId="profile-1" gmail={state([email("latest", "2026-10-08")])} compact />);
    const latestEmail = screen.getByTestId("profile-latest-email");
    expect(latestEmail).toHaveTextContent("Latest email");
    expect(screen.getByRole("link", { name: "Open email" })).toHaveAttribute("href", "/emails?profileId=profile-1&threadId=latest");
    await screen.findByText("A short preview");
    expect(latestEmail).toHaveTextContent("To: Office <office@example.org>");
  });
  it("clearly distinguishes loading, no linked email, and a failed email lookup", () => {
    const { rerender } = render(<ProfileLatestEmail profileId="profile-1" gmail={state([], { loading: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the latest");
    rerender(<ProfileLatestEmail profileId="profile-1" gmail={state([])} />);
    expect(screen.getByText(/No linked profile emails yet/)).toBeInTheDocument();
    rerender(<ProfileLatestEmail profileId="profile-1" gmail={state([], { error: "Email connection unavailable" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Email connection unavailable");
    expect(screen.getByRole("button", { name: "Retry emails" })).toBeInTheDocument();
  });
  it("keeps the exact email link available when its preview fails", async () => {
    mocks.thread.mockRejectedValue(new Error("Unavailable"));
    render(<ProfileLatestEmail profileId="profile-1" gmail={state([email("latest", "2026-10-08")])} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "Open email" })).toHaveAttribute("href", "/emails?profileId=profile-1&threadId=latest");
    expect(screen.getByText("Subject latest")).toBeInTheDocument();
  });
  it("does not fetch a second email list when the profile supplies shared email state", async () => {
    renderHook(() => useProfileGoogleEmail("profile-1", undefined, undefined, false));
    await waitFor(() => expect(mocks.emails).not.toHaveBeenCalled());
  });
  it("does not show a previous profile's preview when profiles change during loading", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.thread.mockImplementation((_profile: string, id: string) => id === "old"
      ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve({ messages: [{ date: "2026-10-08", bodyText: "New profile's email" }] }));
    const { rerender } = render(<ProfileLatestEmail profileId="old-profile" gmail={state([email("old", "2026-10-08")])} />);
    rerender(<ProfileLatestEmail profileId="new-profile" gmail={state([email("new", "2026-10-08")])} />);
    await screen.findByText("New profile's email");
    resolveOld({ messages: [{ date: "2026-10-08", bodyText: "Old profile's private email" }] });
    await waitFor(() => expect(screen.getByText("New profile's email")).toBeInTheDocument());
    expect(screen.queryByText("Old profile's private email")).not.toBeInTheDocument();
  });
});
