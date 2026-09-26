import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssistantWorkspacePage from "./AssistantWorkspacePage";
import { workspaceApi } from "@/features/assistant-workspace/api";
import type { Conversation } from "@/features/assistant-workspace/types";
import { spendingSummary } from "@/test/assistant-spending";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter", () => ({
  useLocation: () => ["/assistant/workspace/chat-1", navigate],
}));
vi.mock("@/features/assistant-workspace/api", () => ({
  workspaceApi: vi.fn(),
  lastConversationKey: "last-chat",
}));
vi.mock("@/features/assistant-workspace/useWorkspaceLayout", () => ({
  useWorkspaceLayout: () => ({
    focused: false,
    setFocused: vi.fn(),
    historyInline: true,
    resultsInline: true,
  }),
}));
vi.mock("@/components/assistant-workspace/OfflinePreparation", () => ({
  OfflinePreparation: () => null,
}));

let conversation: Conversation;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  conversation = {
    id: "chat-1",
    title: "Janet follow-up",
    version: 3,
    lifecycle: "active",
    selection: {
      organizationIds: [],
      bookingId: null,
      threadId: null,
      draftId: null,
      eventYear: null,
    },
    messages: [
      {
        id: "message-1",
        role: "user",
        text: "I prefer short follow-up emails.",
      },
    ],
    drafts: [],
    actions: [],
    runs: [],
  };
  vi.mocked(workspaceApi).mockImplementation(async (path, method, body) => {
    if (path === "/spending") return spendingSummary;
    if (path === "/knowledge") return [];
    if (path === "/status")
      return {
        ready: true,
        models: ["gpt-6-sol"],
        model: "gpt-6-sol",
        checks: [],
      };
    if (path === "/conversations/chat-1") return { ...conversation };
    if (path === "/conversations/chat-1/lifecycle" && method === "PATCH") {
      conversation = {
        ...conversation,
        lifecycle: (body as any).lifecycle,
        version: conversation.version + 1,
      };
      return { ...conversation };
    }
    if (path.startsWith("/conversations?"))
      return path.endsWith(conversation.lifecycle!)
        ? [
            {
              id: conversation.id,
              title: conversation.title,
              version: conversation.version,
              lifecycle: conversation.lifecycle,
            },
          ]
        : [];
    if (path === "/conversations")
      return [
        {
          id: conversation.id,
          title: conversation.title,
          version: conversation.version,
          lifecycle: conversation.lifecycle,
        },
      ];
    throw new Error(`Unexpected request ${method ?? "GET"} ${path}`);
  });
});

describe("conversation controls", () => {
  it("archives with the reviewed version, opens a read-only history view and restores", async () => {
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Archive Janet follow-up" }),
    );
    await waitFor(() =>
      expect(workspaceApi).toHaveBeenCalledWith(
        "/conversations/chat-1/lifecycle",
        "PATCH",
        { version: 3, lifecycle: "archived" },
      ),
    );
    expect(
      await screen.findByText(/This conversation is archived/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Message the assistant" }),
    ).toBeDisabled();
    expect(localStorage.getItem("last-chat")).toBeNull();
    fireEvent.change(screen.getByLabelText("Conversation history"), {
      target: { value: "archived" },
    });
    expect(
      await screen.findByRole("button", { name: "Restore Janet follow-up" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore conversation" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Message the assistant" }),
      ).toBeEnabled(),
    );
    expect(workspaceApi).toHaveBeenCalledWith(
      "/conversations/chat-1/lifecycle",
      "PATCH",
      { version: 4, lifecycle: "active" },
    );
  });

  it("confirms recoverable trash and preserves an unsent message when cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    const input = await screen.findByRole("textbox", {
      name: "Message the assistant",
    });
    fireEvent.change(input, { target: { value: "Unsent message" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Move Janet follow-up to trash" }),
    );
    expect(input).toHaveValue("Unsent message");
    expect(
      vi
        .mocked(workspaceApi)
        .mock.calls.some(([, method]) => method === "PATCH"),
    ).toBe(false);
  });

  it("opens a review of selected message content without automatically remembering it", async () => {
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remember this" }),
    );
    expect(
      await screen.findByRole("textbox", { name: "Important information" }),
    ).toHaveValue("I prefer short follow-up emails.");
    expect(
      vi
        .mocked(workspaceApi)
        .mock.calls.some(
          ([path, method]) =>
            path.startsWith("/knowledge") && method === "POST",
        ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Chat$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Save or cancel your saved info edits",
    );
    expect(
      screen.getByRole("textbox", { name: "Important information" }),
    ).toHaveValue("I prefer short follow-up emails.");
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Chat$/ }));
    expect(
      screen.getByRole("textbox", { name: "Message the assistant" }),
    ).toBeInTheDocument();
  });

  it("keeps failed lifecycle changes visible and reloads the current version", async () => {
    const base = vi.mocked(workspaceApi).getMockImplementation()!;
    vi.mocked(workspaceApi).mockImplementation(
      async (path, method, body, signal) => {
        if (method === "PATCH") throw new Error("ASSISTANT_CONVERSATION_BUSY");
        return base(path, method, body, signal);
      },
    );
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Archive Janet follow-up" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /running or needs its result checked/,
    );
    expect(
      screen.getByRole("textbox", { name: "Message the assistant" }),
    ).toBeEnabled();
  });
  it("keeps the chosen history filter when an earlier list request finishes late", async () => {
    const base = vi.mocked(workspaceApi).getMockImplementation()!;
    let finishRecent!: (value: unknown) => void;
    vi.mocked(workspaceApi).mockImplementation(
      async (path, method, body, signal) => {
        if (path === "/conversations?lifecycle=active")
          return new Promise((resolve) => {
            finishRecent = resolve;
          });
        if (path === "/conversations?lifecycle=archived")
          return [
            {
              id: "archived-1",
              title: "Old saved chat",
              version: 2,
              lifecycle: "archived",
            },
          ];
        return base(path, method, body, signal);
      },
    );
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    fireEvent.change(await screen.findByLabelText("Conversation history"), {
      target: { value: "archived" },
    });
    expect(
      await screen.findByRole("link", { name: "Old saved chat" }),
    ).toBeInTheDocument();
    await act(async () =>
      finishRecent([
        {
          id: "chat-1",
          title: "Janet follow-up",
          version: 3,
          lifecycle: "active",
        },
      ]),
    );
    expect(
      screen.getByRole("link", { name: "Old saved chat" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Janet follow-up" }),
    ).not.toBeInTheDocument();
  });

  it("moves a conversation to recoverable Trash after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Move Janet follow-up to trash",
      }),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("You can restore it later"),
    );
    expect(
      await screen.findByText(/This conversation is in Trash/),
    ).toBeInTheDocument();
    expect(workspaceApi).toHaveBeenCalledWith(
      "/conversations/chat-1/lifecycle",
      "PATCH",
      { version: 3, lifecycle: "trashed" },
    );
  });
});

describe("spending and model controls", () => {
  function useSpending(
    value = { ...spendingSummary, economyModel: "gpt-6-luna" },
    patch?: () => Promise<unknown>,
  ) {
    const base = vi.mocked(workspaceApi).getMockImplementation()!;
    vi.mocked(workspaceApi).mockImplementation(
      async (path, method, body, signal) => {
        if (path === "/spending")
          return method === "PATCH" && patch ? patch() : { ...value };
        if (path === "/status")
          return {
            ready: true,
            models: ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"],
            model: "gpt-6-sol",
            checks: [],
          };
        if (path === "/conversations/chat-2")
          return {
            ...conversation,
            id: "chat-2",
            selectedModel: "gpt-6-astra",
          };
        return base(path, method, body, signal);
      },
    );
    return value;
  }

  it("uses Economy for a new chat and preserves a subsequent manual model across refresh", async () => {
    useSpending();
    render(<AssistantWorkspacePage />);
    const model = await screen.findByRole("combobox", { name: "Model" });
    await waitFor(() => expect(model).toHaveValue("gpt-6-luna"));
    fireEvent.change(model, { target: { value: "gpt-6-astra" } });
    fireEvent.click(screen.getByRole("button", { name: "Adjust spending" }));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh spending usage" }),
      ),
    );
    expect(model).toHaveValue("gpt-6-astra");
  });

  it("keeps a historical model, then uses Economy after creating and loading a conversation with no saved model", async () => {
    conversation.selectedModel = "gpt-6-sol";
    useSpending();
    const fresh = {
      ...conversation,
      id: "chat-new",
      title: "New conversation",
      messages: [],
      selectedModel: null,
    };
    const base = vi.mocked(workspaceApi).getMockImplementation()!;
    vi.mocked(workspaceApi).mockImplementation(
      async (path, method, body, signal) => {
        if (
          (path === "/conversations" && method === "POST") ||
          path === "/conversations/chat-new"
        )
          return fresh;
        return base(path, method, body, signal);
      },
    );
    const view = render(<AssistantWorkspacePage conversationId="chat-1" />);
    const model = await screen.findByRole("combobox", { name: "Model" });
    await screen.findByText("I prefer short follow-up emails.");
    expect(model).toHaveValue("gpt-6-sol");
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/assistant/workspace/chat-new"),
    );
    view.rerender(<AssistantWorkspacePage conversationId="chat-new" />);
    await waitFor(() => expect(model).toHaveValue("gpt-6-luna"));
    expect(workspaceApi).toHaveBeenCalledWith("/conversations/chat-new");
  });

  it("preserves a saved conversation model and only switches after an explicit Economy save", async () => {
    conversation.selectedModel = "gpt-6-sol";
    useSpending(
      { ...spendingSummary, economyMode: false, economyModel: "gpt-6-luna" },
      async () => ({
        ...spendingSummary,
        version: 2,
        economyModel: "gpt-6-luna",
      }),
    );
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    const model = await screen.findByRole("combobox", { name: "Model" });
    await waitFor(() => expect(model).toHaveValue("gpt-6-sol"));
    fireEvent.click(screen.getByRole("button", { name: "Adjust spending" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Economy mode" }));
    expect(model).toHaveValue("gpt-6-sol");
    fireEvent.click(
      screen.getByRole("button", { name: "Save spending settings" }),
    );
    await waitFor(() => expect(model).toHaveValue("gpt-6-luna"));
  });

  it("does not overwrite a newer model choice or another conversation after a delayed settings save", async () => {
    conversation.selectedModel = "gpt-6-sol";
    let finish!: (value: unknown) => void;
    useSpending(
      { ...spendingSummary, economyMode: false, economyModel: "gpt-6-luna" },
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<AssistantWorkspacePage conversationId="chat-1" />);
    const model = await screen.findByRole("combobox", { name: "Model" });
    fireEvent.click(screen.getByRole("button", { name: "Adjust spending" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Economy mode" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save spending settings" }),
    );
    fireEvent.change(model, { target: { value: "gpt-6-astra" } });
    view.rerender(<AssistantWorkspacePage conversationId="chat-2" />);
    await waitFor(() => expect(model).toHaveValue("gpt-6-astra"));
    await act(async () =>
      finish({ ...spendingSummary, version: 2, economyModel: "gpt-6-luna" }),
    );
    expect(model).toHaveValue("gpt-6-astra");
    expect(
      vi
        .mocked(workspaceApi)
        .mock.calls.some(([path]) => path.endsWith("/messages")),
    ).toBe(false);
  });

  it("retains the message while paused and never sends it automatically when usage refresh frees budget", async () => {
    const spending = useSpending({
      ...spendingSummary,
      remainingUsd: 0,
      paused: true,
      economyModel: "gpt-6-luna",
    });
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    const input = await screen.findByRole("textbox", {
      name: "Message the assistant",
    });
    await screen.findByText("I prefer short follow-up emails.");
    fireEvent.change(input, { target: { value: "Continue my research" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(input).toHaveValue("Continue my research");
    spending.paused = false;
    spending.remainingUsd = 0.5;
    fireEvent.click(screen.getByRole("button", { name: "Adjust spending" }));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh spending usage" }),
      ),
    );
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(input).toHaveValue("Continue my research");
    expect(
      vi
        .mocked(workspaceApi)
        .mock.calls.some(([path]) => path.endsWith("/messages")),
    ).toBe(false);
  });

  it("can reconcile an identical lost submission while paused, without allowing edited requests or a new key", async () => {
    conversation.selectedModel = "gpt-6-sol";
    const spending = useSpending();
    const base = vi.mocked(workspaceApi).getMockImplementation()!;
    let attempts = 0;
    vi.mocked(workspaceApi).mockImplementation(
      async (path, method, body, signal) => {
        if (path.endsWith("/messages") && method === "POST") {
          attempts++;
          if (attempts === 1) {
            spending.paused = true;
            spending.remainingUsd = 0;
            conversation = {
              ...conversation,
              messages: [
                ...conversation.messages,
                {
                  id: "accepted-message",
                  role: "user",
                  text: "Continue the saved research",
                },
              ],
              runs: [
                {
                  id: "accepted-run",
                  status: "completed",
                  usage: { steps: 1, tokens: 12 },
                  result: { text: "Previously accepted", receipts: [] },
                },
              ],
            };
            throw new Error("network response lost after acceptance");
          }
          return { id: "accepted-run", status: "completed" };
        }
        return base(path, method, body, signal);
      },
    );
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    await screen.findByText("I prefer short follow-up emails.");
    const input = screen.getByRole("textbox", {
      name: "Message the assistant",
    });
    fireEvent.change(input, {
      target: { value: "Continue the saved research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(
      await screen.findByRole("button", { name: "Check previous request" }),
    ).toBeEnabled();
    expect(attempts).toBe(1);
    fireEvent.change(input, { target: { value: "Start different research" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(attempts).toBe(1);
    fireEvent.change(input, {
      target: { value: "Continue the saved research" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "gpt-6-astra" },
    });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "gpt-6-sol" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Check previous request" }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    const messages = vi
      .mocked(workspaceApi)
      .mock.calls.filter(([path]) => path.endsWith("/messages"));
    expect(messages).toHaveLength(2);
    expect(messages[0].slice(0, 2)).toEqual(messages[1].slice(0, 2));
    expect(messages[1][2]).toEqual({
      ...(messages[0][2] as object),
      reconcileOnly: true,
    });
    expect(screen.getByText("Continue the saved research")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("does not turn a paused reconciliation into a new submission when budget becomes available", async () => {
    conversation.selectedModel = "gpt-6-sol";
    const spending = useSpending();
    const base = vi.mocked(workspaceApi).getMockImplementation()!;
    let attempts = 0;
    vi.mocked(workspaceApi).mockImplementation(
      async (path, method, body, signal) => {
        if (path.endsWith("/messages") && method === "POST") {
          attempts++;
          if (attempts === 1) {
            spending.paused = true;
            spending.remainingUsd = 0;
            throw new Error("network request never arrived");
          }
          expect(body).toMatchObject({ reconcileOnly: true });
          throw new Error("ASSISTANT_REQUEST_NOT_FOUND");
        }
        return base(path, method, body, signal);
      },
    );
    render(<AssistantWorkspacePage conversationId="chat-1" />);
    await screen.findByText("I prefer short follow-up emails.");
    const input = screen.getByRole("textbox", {
      name: "Message the assistant",
    });
    fireEvent.change(input, { target: { value: "Keep this unsent request" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const check = await screen.findByRole("button", {
      name: "Check previous request",
    });
    // The server budget recovers before the page has refreshed its paused view.
    spending.paused = false;
    spending.remainingUsd = 0.5;
    fireEvent.click(check);
    expect(
      await screen.findByText(
        "No saved request was found. Your message is still here; refresh spending and send it when ready.",
      ),
    ).toBeInTheDocument();
    expect(input).toHaveValue("Keep this unsent request");
    expect(
      screen.queryByRole("button", { name: "Check previous request" }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    const messages = vi
      .mocked(workspaceApi)
      .mock.calls.filter(([path]) => path.endsWith("/messages"));
    expect(messages).toHaveLength(2);
    expect(messages[1][2]).toEqual({
      ...(messages[0][2] as object),
      reconcileOnly: true,
    });
  });
});
