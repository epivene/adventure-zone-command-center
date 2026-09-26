import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import AssistantWorkspacePage from "@/pages/AssistantWorkspacePage";
import { DraftPreview } from "./DraftPreview";
import { workspaceApi } from "@/features/assistant-workspace/api";
import { mockNativeDialog } from "@/test/native-dialog";
import { spendingSummary } from "@/test/assistant-spending";
vi.mock("@/features/assistant-workspace/api", () => ({
  workspaceApi: vi.fn(),
  lastConversationKey: "test-last-conversation",
}));
const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Saved reply",
  version: 1,
  selection: { organizationIds: [], eventYear: null },
  messages: [{ id: "m", role: "user", text: "Keep the deposit at 40%" }],
  actions: [],
  drafts: [],
  runs: [],
};
let restoreDialog: () => void;
beforeEach(() => {
  restoreDialog = mockNativeDialog();
  vi.mocked(workspaceApi).mockReset();
  vi.mocked(workspaceApi).mockImplementation(async (path) => {
    if (path === "/spending") return spendingSummary;
    if (path === "/status")
      return {
        enabled: true,
        ready: true,
        providerVerification: "not_checked",
        checks: [],
        model: "configured-model",
        models: ["configured-model"],
      } as any;
    if (path === "/conversations" || path.startsWith("/conversations?"))
      return [conversation] as any;
    return conversation as any;
  });
});
afterEach(() => restoreDialog());
it("restores saved conversation and Enter in composer never sends email", async () => {
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  expect(await screen.findByText("Keep the deposit at 40%")).toBeTruthy();
  const composer = screen.getByLabelText("Message the assistant");
  fireEvent.change(composer, { target: { value: "Make it warmer" } });
  fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.some(([path, method]) => method === "POST"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(workspaceApi)
        .mock.calls.some(([path]) => path.endsWith("/messages")),
    ).toBe(true),
  );
  expect(
    vi.mocked(workspaceApi).mock.calls.some(([path]) => path.endsWith("/send")),
  ).toBe(false);
});
it("isolates an HTML draft preview without script or same-origin permissions", () => {
  const draft: any = {
    id: "d",
    revision: "r",
    status: "local",
    content: {
      subject: "Reply",
      to: ["a@example.test"],
      cc: [],
      html: "<p>Hello</p><script>alert(1)</script>",
      threadId: "t",
      attachmentIds: [],
      templateVersion: "v1",
    },
  };
  render(
    <DraftPreview
      draft={draft}
      onRevise={() => {}}
      onSave={() => {}}
      busy={false}
    />,
  );
  const frame = screen.getByTitle("Preview: Reply");
  expect(frame.getAttribute("sandbox")).toBe("");
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
});

it("formats assistant messages while keeping user wording literal", async () => {
  const original = vi.mocked(workspaceApi).getMockImplementation()!;
  vi.mocked(workspaceApi).mockImplementation(async (path, ...args) => {
    if (path === `/conversations/${conversation.id}`)
      return {
        ...conversation,
        messages: [
          { id: "user-markup", role: "user", text: "Keep **these asterisks**" },
          {
            id: "assistant-markup",
            role: "assistant",
            text: "This is **ready for review**.",
          },
        ],
      } as any;
    return original(path, ...args);
  });
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  expect(
    await screen.findByText("ready for review", { selector: "strong" }),
  ).toBeVisible();
  expect(screen.getByText("Keep **these asterisks**")).toBeVisible();
});

it("does not display an old conversation response after switching chats", async () => {
  let finishOld!: (value: any) => void;
  const old = new Promise((resolve) => {
    finishOld = resolve;
  });
  const newer = {
    ...conversation,
    id: "22222222-2222-4222-8222-222222222222",
    messages: [{ id: "new", role: "user", text: "Current customer" }],
  };
  vi.mocked(workspaceApi).mockImplementation(async (path) => {
    if (path === "/status")
      return {
        enabled: true,
        ready: true,
        providerVerification: "not_checked",
        checks: [],
        model: "configured-model",
        models: ["configured-model"],
      } as any;
    if (path === "/conversations") return [conversation, newer] as any;
    if (path.endsWith(conversation.id)) return old as any;
    return newer as any;
  });
  const view = render(
    <AssistantWorkspacePage conversationId={conversation.id} />,
  );
  view.rerender(<AssistantWorkspacePage conversationId={newer.id} />);
  expect(await screen.findByText("Current customer")).toBeTruthy();
  finishOld(conversation);
  await waitFor(() =>
    expect(screen.queryByText("Keep the deposit at 40%")).toBeNull(),
  );
});

it("holds saved conversation reads until setup is ready and recovers through refresh", async () => {
  let ready = false;
  vi.mocked(workspaceApi).mockImplementation(async (path) => {
    if (path === "/status")
      return {
        enabled: true,
        ready,
        model: "configured-model",
        models: ["configured-model"],
        providerVerification: "not_checked",
        checks: [],
      } as any;
    if (path === "/conversations") return [conversation] as any;
    return conversation as any;
  });
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  expect(
    await screen.findByRole("button", { name: "Refresh setup status" }),
  ).toBeTruthy();
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.some(([path]) => path.startsWith("/conversations")),
  ).toBe(false);
  ready = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh setup status" }));
  expect(await screen.findByText("Keep the deposit at 40%")).toBeTruthy();
});

it("shows a retry when a setup refresh fails after chat was available", async () => {
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  expect(await screen.findByText("Keep the deposit at 40%")).toBeTruthy();
  vi.mocked(workspaceApi).mockRejectedValueOnce(
    new Error("network unavailable"),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh setup status" }),
    );
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Setup status could not be loaded",
  );
  expect(
    screen.getByRole("button", { name: "Refresh setup status" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh setup status" }));
  expect(await screen.findByText("Keep the deposit at 40%")).toBeTruthy();
});

it("opens named compact panels without clearing the message and closes history after selection", async () => {
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  await screen.findByText("Keep the deposit at 40%");
  const composer = await screen.findByLabelText("Message the assistant");
  fireEvent.change(composer, { target: { value: "Keep this follow-up" } });
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  expect(screen.getByRole("dialog", { name: "Conversations" })).toHaveAttribute(
    "aria-modal",
    "true",
  );
  const saved = await screen.findByRole("link", { name: "Saved reply" });
  expect(saved).toHaveAttribute("aria-current", "page");
  fireEvent.click(saved);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Drafts and actions (0)" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Drafts and actions" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Close drafts and actions" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(composer).toHaveValue("Keep this follow-up");
});

it("saves a direct draft edit through PATCH and uses the returned revision for Gmail", async () => {
  const draft = {
    id: "draft-id",
    revision: "original",
    status: "saved",
    gmailDraftId: "gmail-id",
    content: {
      to: ["janet@example.test"],
      cc: [],
      subject: "Deposit check",
      html: "<p>Hi Janet</p>",
      text: "Hi Janet",
      threadId: null,
      attachmentIds: [],
      templateId: null,
      templateVersion: "1",
    },
  };
  let saved = { ...conversation, drafts: [draft] };
  vi.mocked(workspaceApi).mockImplementation(
    async (path, method, body: any) => {
      if (path === "/status")
        return {
          enabled: true,
          ready: true,
          providerVerification: "not_checked",
          checks: [],
          model: "gpt-6-sol",
          models: ["gpt-6-sol", "gpt-5.4-mini", "gpt-5.4-nano"],
        } as any;
      if (path === "/conversations") return [conversation] as any;
      if (path === "/drafts/draft-id" && method === "PATCH") {
        const edited = {
          ...draft,
          revision: "edited",
          status: "local",
          content: {
            ...draft.content,
            subject: body.subject,
            html: body.html,
            text: body.text,
          },
        };
        saved = { ...saved, drafts: [edited] };
        return edited as any;
      }
      return saved as any;
    },
  );
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  await screen.findByText("Keep the deposit at 40%");
  expect(
    screen.getByRole("option", { name: "GPT-5.4 Mini · Lower cost" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Drafts and actions (1)" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit email preview" }));
  fireEvent.change(screen.getByLabelText("Email subject"), {
    target: { value: "Quick check" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(
    "Changes saved in the app. Save in Gmail to update the Gmail draft.",
  );
  expect(workspaceApi).toHaveBeenCalledWith(
    "/drafts/draft-id",
    "PATCH",
    expect.objectContaining({
      revision: "original",
      subject: "Quick check",
      html: "<p>Hi Janet</p>",
      text: "Hi Janet",
    }),
  );
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.some(
        ([path]) => path.endsWith("/messages") || path.endsWith("/send"),
      ),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save in Gmail" }));
  await waitFor(() =>
    expect(workspaceApi).toHaveBeenCalledWith(
      "/drafts/draft-id/save-gmail",
      "POST",
      expect.objectContaining({ revision: "edited" }),
    ),
  );
});
