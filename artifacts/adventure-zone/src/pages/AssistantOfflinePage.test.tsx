import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthToken } from "@/lib/auth-token";
import type { Conversation, Draft } from "@/features/assistant-workspace/types";
import { offlineDraftVersion } from "@/features/assistant-workspace/offline-store";
import AssistantOfflinePage from "./AssistantOfflinePage";

const storage = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  sync: vi.fn(),
  clear: vi.fn(),
  discard: vi.fn(),
}));
vi.mock(
  "@/features/assistant-workspace/offline-store",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/assistant-workspace/offline-store")
    >()),
    loadOfflineWorkspace: storage.load,
    saveOfflineDraft: storage.save,
    clearOfflineWorkspace: storage.clear,
    discardOfflineDraft: storage.discard,
  }),
);
vi.mock("@/features/assistant-workspace/offline-sync", () => ({
  syncOfflineDraft: storage.sync,
}));

const base: Draft = {
  id: "draft-one",
  revision: "revision-one",
  status: "saved",
  gmailDraftId: "gmail-one",
  content: {
    to: ["janet@example.test"],
    cc: ["office@example.test"],
    subject: "Deposit check",
    html: '<table class="brand"><tbody><tr><td><p>Hello Janet</p><img src="https://tracking.test/pixel" alt="Brand logo"><p>Has the check been sent?</p></td></tr></tbody></table>',
    text: "Hello Janet\nHas the check been sent?",
    threadId: "thread-one",
    attachmentIds: ["attachment-one"],
    templateId: "template-one",
    templateVersion: "3",
  },
};
const conversation: Conversation = {
  id: "conversation-one",
  title: "County fair",
  version: 4,
  selection: {
    organizationIds: ["profile-one"],
    bookingId: null,
    threadId: "thread-one",
    draftId: "draft-one",
    eventYear: 2026,
  },
  messages: [
    {
      id: "message-one",
      role: "assistant",
      text: "Recorded deposit: $100",
      attachments: [
        {
          id: "screenshot-one",
          filename: "check.png",
          contentType: "image/png",
          byteSize: 100,
          sha256: "hash",
        },
      ],
    },
  ],
  actions: [],
  drafts: [base],
  runs: [],
};
function fixture() {
  return {
    snapshots: [
      {
        conversation: structuredClone(conversation),
        preparedAt: Date.now() - 60_000,
        expiresAt: Date.now() + 86_400_000,
        profiles: [
          {
            id: "profile-one",
            name: "County Fair Association",
            details: { phone: "555-0100", contact: { name: "Janet" } },
          },
        ],
        rules: [
          {
            id: "rule-one",
            ruleKey: "deposit",
            body: "Confirm receipt before marking paid.",
            version: 2,
            status: "active",
            sourceLabel: "Owner policy",
            organizationId: null,
            eventYear: null,
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
            reviewedAt: null,
          },
        ],
        drafts: [
          {
            id: base.id,
            base: structuredClone(base),
            local: null as Draft["content"] | null,
            savedAt: null as number | null,
            conflict: null as Draft | null,
            syncState: "idle" as "idle" | "uncertain",
          },
        ],
      },
    ],
  };
}
let workspace: ReturnType<typeof fixture>;
function connected(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online,
  });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
function editBody(value: string) {
  const field = screen.getByText("Hello Janet");
  field.textContent = value;
  fireEvent.input(field);
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem("az_owner_token", "owner-one");
  connected(false);
  workspace = fixture();
  storage.load.mockImplementation(async () => structuredClone(workspace));
  storage.save.mockImplementation(async (_conversationId, _draftId, edits) => {
    Object.assign(workspace.snapshots[0].drafts[0], {
      local: edits,
      savedAt: Date.now(),
    });
    return structuredClone(workspace.snapshots[0].drafts[0]);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AssistantOfflinePage", () => {
  it("fully reloads the selected online conversation under its base path and blocks unsaved navigation", async () => {
    vi.stubEnv("BASE_URL", "/fold/");
    render(<AssistantOfflinePage />);
    const subject = await screen.findByLabelText("Email subject");
    const link = screen.getByRole("link", { name: "Open online workspace" });
    expect(link).toHaveAttribute(
      "href",
      "/fold/assistant/workspace/conversation-one",
    );
    const navigationPrevented: boolean[] = [];
    const observeNavigation = (event: MouseEvent) => {
      navigationPrevented.push(event.defaultPrevented);
      // Observe app behavior, then suppress jsdom's unsupported full navigation.
      event.preventDefault();
    };
    document.addEventListener("click", observeNavigation);
    try {
      fireEvent.click(link);
      fireEvent.change(subject, { target: { value: "Unsaved subject" } });
      fireEvent.click(link);
    } finally {
      document.removeEventListener("click", observeNavigation);
    }
    expect(navigationPrevented).toEqual([false, true]);
  });

  it("reads prepared records without live resources and labels their snapshot limits", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { container } = render(<AssistantOfflinePage />);
    expect(
      await screen.findByText("County Fair Association"),
    ).toBeInTheDocument();
    expect(screen.getByText("555-0100")).toBeInTheDocument();
    expect(screen.getByText("Janet", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByText("Confirm receipt before marking paid."),
    ).toBeInTheDocument();
    expect(screen.getByText("Recorded deposit: $100")).toBeInTheDocument();
    expect(screen.getByText(/prepared.*ago/i)).toBeInTheDocument();
    expect(screen.getByText(/access expires/i)).toBeInTheDocument();
    expect(
      screen.getByText(/balances.*availability.*insurance.*gmail/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI.*internet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/documents.*images.*not downloaded/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/janet@example.test/)).toBeInTheDocument();
    expect(screen.getByText(/office@example.test/)).toBeInTheDocument();
    expect(screen.getByText(/attachment-one/)).toBeInTheDocument();
    expect(container.querySelector("iframe,img,script")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /send|gmail/i })).toBeNull();
  });

  it("saves deliberate subject and branded body edits locally before allowing explicit online sync", async () => {
    const view = render(<AssistantOfflinePage />);
    const subject = await screen.findByLabelText("Email subject");
    fireEvent.change(subject, { target: { value: "Quick check" } });
    editBody("Hi Janet!");
    expect(storage.save).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sync draft changes" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save on device" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /saved on this device/i,
    );
    expect(storage.save).toHaveBeenCalledWith(
      "conversation-one",
      "draft-one",
      {
        subject: "Quick check",
        html: expect.stringContaining('<table class="brand">'),
        text: expect.stringContaining("Hi Janet!"),
      },
      expect.any(String),
    );
    expect(workspace.snapshots[0].drafts[0].local!.html).toContain("Hi Janet!");
    view.unmount();
    render(<AssistantOfflinePage />);
    expect(await screen.findByLabelText("Email subject")).toHaveValue(
      "Quick check",
    );
    expect(screen.getByText("Hi Janet!")).toBeInTheDocument();
    act(() => connected(true));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sync draft changes" }),
      ).toBeEnabled(),
    );
    expect(storage.sync).not.toHaveBeenCalled();
    const synced = structuredClone(workspace.snapshots[0].drafts[0]);
    synced.base = {
      ...synced.base,
      revision: "revision-two",
      content: { ...synced.base.content, ...synced.local },
    };
    synced.local = null;
    storage.sync.mockResolvedValue({ status: "synced", draft: synced });
    fireEvent.click(screen.getByRole("button", { name: "Sync draft changes" }));
    expect(await screen.findByText(/synced.*app.*gmail/i)).toBeInTheDocument();
    expect(storage.sync).toHaveBeenCalledExactlyOnceWith(
      "conversation-one",
      "draft-one",
    );
    expect(
      screen.getByRole("button", { name: "Sync draft changes" }),
    ).toBeDisabled();
  });

  it("keeps failed local saves editable and prevents losing them by switching conversations", async () => {
    const second = structuredClone(workspace.snapshots[0]);
    second.conversation.id = "conversation-two";
    second.conversation.title = "Next event";
    workspace.snapshots.push(second);
    storage.save.mockRejectedValue(new Error("Storage is full"));
    render(<AssistantOfflinePage />);
    fireEvent.change(await screen.findByLabelText("Email subject"), {
      target: { value: "Keep this subject" },
    });
    editBody("Keep this body");
    expect(screen.getByLabelText("Prepared conversation")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save on device" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /storage.*full/i,
    );
    expect(screen.getByLabelText("Email subject")).toHaveValue(
      "Keep this subject",
    );
    expect(screen.getByText("Keep this body")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save on device" }),
    ).toBeEnabled();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("retains copyable local edits alongside the newer server draft after a conflict", async () => {
    connected(true);
    const saved = workspace.snapshots[0].drafts[0];
    saved.local = {
      ...base.content,
      subject: "My subject",
      text: "My saved words",
      html: "<p>My saved words</p>",
    };
    saved.savedAt = Date.now();
    const conflict = structuredClone(saved);
    conflict.conflict = {
      ...base,
      revision: "newer",
      content: {
        ...base.content,
        subject: "Server subject",
        text: "Newer server words",
      },
    };
    storage.sync.mockResolvedValue({ status: "conflict", draft: conflict });
    render(<AssistantOfflinePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sync draft changes" }),
    );
    expect(await screen.findByLabelText("Your saved local text")).toHaveValue(
      "My saved words",
    );
    expect(screen.getByText("Server subject")).toBeInTheDocument();
    expect(screen.getByText("Newer server words")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync draft changes" }),
    ).toBeDisabled();
  });

  it("discards a conflicting local draft only after confirmation and keeps the server copy", async () => {
    connected(true);
    const draft = workspace.snapshots[0].drafts[0];
    draft.local = {
      ...base.content,
      subject: "My saved subject",
      html: "<p>My saved body</p>",
      text: "My saved body",
    };
    draft.savedAt = Date.now();
    draft.conflict = {
      ...base,
      revision: "revision-two",
      content: {
        ...base.content,
        subject: "Current app subject",
        html: "<p>Current app body</p>",
        text: "Current app body",
      },
    };
    storage.discard.mockResolvedValue({
      ...draft,
      base: draft.conflict,
      local: null,
      conflict: null,
      savedAt: null,
    });
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<AssistantOfflinePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard local changes" }),
    );
    expect(screen.getByLabelText("Your saved local text")).toHaveValue(
      "My saved body",
    );
    expect(storage.discard).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Discard local changes" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Email subject")).toHaveValue(
        "Current app subject",
      ),
    );
    expect(screen.getByText("Current app body")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your saved local text")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Sync draft changes" }),
    ).toBeDisabled();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(storage.discard).toHaveBeenCalledExactlyOnceWith(
      "conversation-one",
      "draft-one",
      expect.any(String),
    );
    expect(storage.sync).not.toHaveBeenCalled();
  });

  it("hides an owner's records immediately when the token changes in another tab", async () => {
    render(<AssistantOfflinePage />);
    await screen.findByText("County Fair Association");
    storage.load.mockImplementation(() => new Promise(() => {}));
    act(() => {
      localStorage.setItem("az_owner_token", "owner-two");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "az_owner_token",
          newValue: "owner-two",
        }),
      );
    });
    expect(screen.queryByText("County Fair Association")).toBeNull();
    expect(screen.queryByLabelText("Email subject")).toBeNull();
  });

  it("ignores an earlier load that completes after logout", async () => {
    let resolveOld!: (data: ReturnType<typeof fixture>) => void;
    storage.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    render(<AssistantOfflinePage />);
    storage.load.mockResolvedValue({ snapshots: [] });
    act(() => setAuthToken(null));
    await screen.findByText(/no prepared conversations/i);
    await act(async () => resolveOld(fixture()));
    expect(screen.queryByText("County Fair Association")).toBeNull();
  });

  it("shows storage errors without claiming the workspace is empty or ready", async () => {
    storage.load.mockRejectedValue(new Error("Cannot open device storage"));
    render(<AssistantOfflinePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cannot open device storage/i,
    );
    expect(screen.queryByText(/no prepared conversations/i)).toBeNull();
  });

  it("preserves unsaved edits if a reconnect cannot reopen device storage", async () => {
    render(<AssistantOfflinePage />);
    fireEvent.change(await screen.findByLabelText("Email subject"), {
      target: { value: "Keep my reconnect edit" },
    });
    editBody("Keep my reconnect body");
    storage.load.mockRejectedValue(new Error("Cannot reopen device storage"));
    act(() => connected(true));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cannot reopen device storage/i,
    );
    expect(screen.getByLabelText("Email subject")).toHaveValue(
      "Keep my reconnect edit",
    );
    expect(screen.getByText("Keep my reconnect body")).toBeInTheDocument();
  });

  it("keeps in-progress text when reconnect loads a newer device draft", async () => {
    render(<AssistantOfflinePage />);
    await screen.findByLabelText("Email subject");
    const opened = offlineDraftVersion(workspace.snapshots[0].drafts[0]);
    fireEvent.change(screen.getByLabelText("Email subject"), {
      target: { value: "My unsaved subject" },
    });
    editBody("My unsaved body");
    workspace.snapshots[0].drafts[0].local = {
      ...base.content,
      subject: "Saved in another tab",
      html: "<p>Other saved body</p>",
      text: "Other saved body",
    };
    workspace.snapshots[0].drafts[0].savedAt = Date.now();
    act(() => connected(true));
    await act(async () => {});
    expect(screen.getByText("My unsaved body")).toBeInTheDocument();
    expect(screen.queryByText("Other saved body")).toBeNull();
    storage.save.mockRejectedValueOnce(
      new Error("The local draft changed in another tab."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save on device" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/another tab/);
    expect(storage.save).toHaveBeenCalledWith(
      "conversation-one",
      "draft-one",
      expect.objectContaining({
        subject: "My unsaved subject",
        text: expect.stringContaining("My unsaved body"),
      }),
      opened,
    );
    expect(screen.getByText("My unsaved body")).toBeInTheDocument();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel unsaved editing" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Email subject")).toHaveValue(
        "Saved in another tab",
      ),
    );
    expect(screen.getByText("Other saved body")).toBeInTheDocument();
    expect(storage.discard).not.toHaveBeenCalled();
  });

  it("does not replace a successful local save with an older pending reload", async () => {
    render(<AssistantOfflinePage />);
    fireEvent.change(await screen.findByLabelText("Email subject"), {
      target: { value: "My latest save" },
    });
    const old = structuredClone(workspace);
    let resolveReload!: (data: ReturnType<typeof fixture>) => void;
    storage.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReload = resolve;
        }),
    );
    act(() => connected(true));
    fireEvent.click(screen.getByRole("button", { name: "Save on device" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /saved on this device/i,
    );
    await act(async () => resolveReload(old));
    expect(screen.getByLabelText("Email subject")).toHaveValue(
      "My latest save",
    );
    expect(
      screen.getByRole("button", { name: "Sync draft changes" }),
    ).toBeEnabled();
  });

  it("removes an expired snapshot while the local page remains open", async () => {
    vi.useFakeTimers();
    workspace.snapshots[0].expiresAt = Date.now() + 1000;
    render(<AssistantOfflinePage />);
    await act(async () => {});
    expect(screen.getByText("County Fair Association")).toBeInTheDocument();
    storage.load.mockImplementation(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(1100));
    expect(screen.queryByText("County Fair Association")).toBeNull();
    expect(screen.queryByLabelText("Email subject")).toBeNull();
  });
});
