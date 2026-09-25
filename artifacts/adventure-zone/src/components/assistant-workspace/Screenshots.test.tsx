import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AssistantWorkspacePage from "@/pages/AssistantWorkspacePage";
import { workspaceApi } from "@/features/assistant-workspace/api";
import {
  uploadScreenshot,
  readScreenshot,
} from "@/features/assistant-workspace/screenshots";
vi.mock("@/features/assistant-workspace/api", () => ({
  workspaceApi: vi.fn(),
  lastConversationKey: "screenshot-conversation",
}));
vi.mock("@/features/assistant-workspace/screenshots", () => ({
  uploadScreenshot: vi.fn(),
  readScreenshot: vi.fn(),
}));
const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Screenshots",
  version: 1,
  selection: { organizationIds: [] },
  messages: [],
  actions: [],
  drafts: [],
  runs: [],
};
const file = () =>
  new File(["image bytes"], "question.png", { type: "image/png" });
beforeEach(() => {
  vi.mocked(workspaceApi).mockReset();
  vi.mocked(uploadScreenshot).mockReset();
  vi.mocked(readScreenshot).mockReset();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:screenshot");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.mocked(uploadScreenshot).mockResolvedValue({ id: "uploaded" } as any);
  vi.mocked(readScreenshot).mockResolvedValue(
    new Blob(["image"], { type: "image/png" }),
  );
  vi.mocked(workspaceApi).mockImplementation(async (path, method) => {
    if (path === "/status")
      return {
        ready: true,
        checks: [],
        model: "vision",
        models: ["vision"],
      } as any;
    if (path === "/conversations")
      return (method === "POST" ? conversation : []) as any;
    return conversation as any;
  });
});
it("uploads an image-only message and keeps its exact retry identity after an uncertain send", async () => {
  render(<AssistantWorkspacePage />);
  const picker = await screen.findByLabelText("Attach screenshots");
  fireEvent.change(picker, { target: { files: [file()] } });
  expect(
    screen.getByRole("img", { name: "Preview: question.png" }),
  ).toBeTruthy();
  let attempts = 0;
  const implementation = vi.mocked(workspaceApi).getMockImplementation()!;
  vi.mocked(workspaceApi).mockImplementation(async (...args) => {
    if (args[0].endsWith("/messages") && ++attempts === 1)
      throw new Error("network");
    return implementation(...args);
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("img", { name: "Preview: question.png" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(attempts).toBe(2));
  const sends = vi
    .mocked(workspaceApi)
    .mock.calls.filter(([p]) => p.endsWith("/messages"));
  expect(sends[0].slice(0, 3)).toEqual(sends[1].slice(0, 3));
  expect(sends[0][2]).toMatchObject({
    text: "",
    attachmentIds: [expect.any(String)],
  });
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.filter(([p, m]) => p === "/conversations" && m === "POST"),
  ).toHaveLength(1);
  expect(uploadScreenshot).toHaveBeenCalledTimes(1);
});
it("supports paste/drop, removal and clear file validation without uploading before send", async () => {
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  const composer = await screen.findByLabelText("Message the assistant");
  fireEvent.paste(composer, { clipboardData: { files: [file()] } });
  expect(
    screen.getByRole("img", { name: "Preview: question.png" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove question.png" }));
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  fireEvent.drop(composer, {
    dataTransfer: {
      files: [new File(["svg"], "unsafe.svg", { type: "image/svg+xml" })],
    },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("PNG, JPEG or WebP");
  fireEvent.drop(composer, {
    dataTransfer: { files: [file(), file(), file(), file(), file()] },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("four screenshots");
  fireEvent.drop(composer, { dataTransfer: { files: [file()] } });
  expect(
    screen.getByRole("img", { name: "Preview: question.png" }),
  ).toBeTruthy();
  expect(uploadScreenshot).not.toHaveBeenCalled();
});
it("does not send into or clear another chat after navigation during upload", async () => {
  let finish!: (value: any) => void;
  vi.mocked(uploadScreenshot).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <AssistantWorkspacePage conversationId={conversation.id} />,
  );
  fireEvent.change(await screen.findByLabelText("Attach screenshots"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(uploadScreenshot).toHaveBeenCalled());
  view.rerender(
    <AssistantWorkspacePage conversationId="22222222-2222-4222-8222-222222222222" />,
  );
  fireEvent.change(await screen.findByLabelText("Message the assistant"), {
    target: { value: "New chat text" },
  });
  finish({ id: "uploaded" });
  await waitFor(() =>
    expect(screen.getByLabelText("Message the assistant")).toHaveValue(
      "New chat text",
    ),
  );
  expect(
    vi.mocked(workspaceApi).mock.calls.some(([p]) => p.endsWith("/messages")),
  ).toBe(false);
});
it("restores saved screenshots through authenticated blob reads", async () => {
  const implementation = vi.mocked(workspaceApi).getMockImplementation()!;
  vi.mocked(workspaceApi).mockImplementation(async (...args) =>
    args[0] === `/conversations/${conversation.id}`
      ? {
          ...conversation,
          messages: [
            {
              id: "m",
              role: "user",
              text: "",
              attachments: [
                {
                  id: "image-id",
                  filename: "saved.png",
                  contentType: "image/png",
                },
              ],
            },
          ],
        }
      : implementation(...args),
  );
  render(<AssistantWorkspacePage conversationId={conversation.id} />);
  expect(await screen.findByRole("img", { name: "saved.png" })).toHaveAttribute(
    "src",
    "blob:screenshot",
  );
  expect(readScreenshot).toHaveBeenCalledWith(
    conversation.id,
    "image-id",
    expect.any(AbortSignal),
  );
});
