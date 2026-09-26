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
    fireEvent.click(
      screen.getByRole("button", { name: /^Cancel$/ }),
    );
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
