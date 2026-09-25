import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AssistantWorkspacePage from "@/pages/AssistantWorkspacePage";
import { workspaceApi } from "@/features/assistant-workspace/api";
import type { Conversation } from "@/features/assistant-workspace/types";
import { mockNativeDialog } from "@/test/native-dialog";

vi.mock("@/features/assistant-workspace/api", () => ({
  workspaceApi: vi.fn(),
  lastConversationKey: "test-last-conversation",
}));

const conversation: Conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Saved reply",
  version: 1,
  selection: {
    organizationIds: [],
    bookingId: null,
    threadId: null,
    draftId: null,
    eventYear: null,
  },
  messages: [{ id: "message-id", role: "user", text: "Prepare my reply" }],
  actions: [],
  runs: [],
  drafts: [
    {
      id: "draft-id",
      revision: "revision-1",
      status: "local",
      gmailDraftId: null,
      content: {
        to: ["janet@example.test"],
        cc: [],
        subject: "A quick question",
        html: "<p>Hi Janet</p>",
        text: "Hi Janet",
        threadId: null,
        attachmentIds: [],
        templateId: null,
        templateVersion: null,
      },
    },
  ],
};

// jsdom has no device media queries; keep the real page and layout hook in use.
function device(initial: { width: number; coarse: boolean; touch?: boolean }) {
  let state = initial;
  const listeners = new Map<string, Set<() => void>>();
  const matches = (query: string) => {
    if (query === "(pointer: coarse)") return state.coarse;
    if (query === "(any-pointer: coarse)") return state.touch ?? state.coarse;
    const width = /min-width:\s*(\d+)px/.exec(query);
    return width ? state.width >= Number(width[1]) : false;
  };
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return matches(query);
    },
    onchange: null,
    addEventListener: (_: string, listener: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(listener);
    },
    removeEventListener: (_: string, listener: () => void) =>
      listeners.get(query)?.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
  return (next: Partial<typeof initial>) =>
    act(() => {
      state = { ...state, ...next };
      for (const callbacks of listeners.values())
        for (const callback of callbacks) callback();
    });
}

let restoreDialog: () => void;
beforeEach(() => {
  localStorage.clear();
  restoreDialog = mockNativeDialog();
  vi.mocked(workspaceApi).mockImplementation(async (path) => {
    if (path === "/status")
      return {
        enabled: true,
        ready: true,
        providerVerification: "not_checked",
        checks: [],
        model: "gpt-5.4-mini",
        models: ["gpt-5.4-mini"],
      } as any;
    if (path === "/conversations") return [conversation] as any;
    if (path === `/conversations/${conversation.id}`)
      return conversation as any;
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => {
  restoreDialog();
  vi.unstubAllGlobals();
  vi.mocked(workspaceApi).mockReset();
});

it("uses focused chat on a wide touch viewport instead of opening desktop rails", async () => {
  device({ width: 1800, coarse: true });
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  await screen.findByText("Prepare my reply");
  expect(
    screen.queryAllByRole("complementary", {
      name: /^(Conversations|Drafts and actions)$/,
    }),
  ).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Focus chat" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Drafts and actions (1)" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Drafts and actions" }),
  ).toBeVisible();
});

it.each([
  { coarse: false, initial: "false", saved: "true" },
  { coarse: true, initial: "true", saved: "false" },
])(
  "restores the explicit layout choice when primary coarse pointer is $coarse",
  async ({ coarse, initial, saved }) => {
    device({ width: 1800, coarse });
    const view = render(
      <AssistantWorkspacePage conversationId={conversation.id} />,
    );
    await screen.findByText("Prepare my reply");
    const toggle = screen.getByRole("button", { name: "Focus chat" });
    expect(toggle).toHaveAttribute("aria-pressed", initial);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", saved);
    view.unmount();
    render(<AssistantWorkspacePage conversationId={conversation.id} />);
    await screen.findByText("Prepare my reply");
    expect(screen.getByRole("button", { name: "Focus chat" })).toHaveAttribute(
      "aria-pressed",
      saved,
    );
    expect(
      screen.queryAllByRole("complementary", {
        name: /^(Conversations|Drafts and actions)$/,
      }),
    ).toHaveLength(saved === "true" ? 0 : 2);
  },
);

it("follows primary pointer changes until a choice is saved, without treating every touchscreen as a phone", async () => {
  const changeDevice = device({ width: 1800, coarse: false, touch: true });
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  await screen.findByText("Prepare my reply");
  const toggle = screen.getByRole("button", { name: "Focus chat" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(
    screen.queryAllByRole("complementary", {
      name: /^(Conversations|Drafts and actions)$/,
    }),
  ).toHaveLength(2);
  changeDevice({ coarse: true });
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.queryAllByRole("complementary", {
      name: /^(Conversations|Drafts and actions)$/,
    }),
  ).toHaveLength(0);
  fireEvent.click(toggle);
  changeDevice({ coarse: false });
  changeDevice({ coarse: true });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  changeDevice({ width: 1000 });
  expect(
    screen.queryAllByRole("complementary", {
      name: /^(Conversations|Drafts and actions)$/,
    }),
  ).toHaveLength(0);
  expect(
    screen.getByRole("button", { name: "Drafts and actions (1)" }),
  ).toBeVisible();
});

it("keeps the current draft editor and unsaved wording when changing layout", async () => {
  device({ width: 1800, coarse: false });
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  await screen.findByText("Prepare my reply");
  fireEvent.click(screen.getByRole("button", { name: "Edit email preview" }));
  const subject = screen.getByRole("textbox", { name: "Email subject" });
  fireEvent.change(subject, { target: { value: "My unfinished wording" } });
  fireEvent.click(screen.getByRole("button", { name: "Focus chat" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen.getByRole("dialog", { name: "Drafts and actions" }),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Email subject" })).toBe(subject);
  fireEvent.click(
    screen.getByRole("button", { name: "Close drafts and actions" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Focus chat" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("textbox", { name: "Email subject" })).toBe(subject);
  expect(subject).toHaveValue("My unfinished wording");
});

it("does not reopen a stale history sheet when switching from expanded to focused", async () => {
  const changeDevice = device({ width: 1000, coarse: false });
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  await screen.findByText("Prepare my reply");
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  changeDevice({ width: 1800 });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Focus chat" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Drafts and actions (1)" }),
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen.getByRole("dialog", { name: "Drafts and actions" }),
  ).toBeVisible();
});
