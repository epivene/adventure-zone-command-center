import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AssistantWorkspacePage from "@/pages/AssistantWorkspacePage";
import { DraftPreview } from "./DraftPreview";
import { workspaceApi } from "@/features/assistant-workspace/api";
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
beforeEach(() => {
  vi.mocked(workspaceApi).mockReset();
  vi.mocked(workspaceApi).mockImplementation(async (path) => {
    if (path === "/status")
      return {
        enabled: true,
        model: "configured-model",
        models: ["configured-model"],
      } as any;
    if (path === "/conversations") return [conversation] as any;
    return conversation as any;
  });
});
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
