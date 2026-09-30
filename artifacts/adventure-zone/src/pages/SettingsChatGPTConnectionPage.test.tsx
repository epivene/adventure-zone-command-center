import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
const client = vi.hoisted(() => ({ connectionRequest: vi.fn() }));
vi.mock("@/features/chatgpt-connection/client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/chatgpt-connection/client")
  >()),
  ...client,
}));
import SettingsChatGPTConnectionPage from "./SettingsChatGPTConnectionPage";
import ChatGPTConnectionConsentPage from "./ChatGPTConnectionConsentPage";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/");
});
it("shows endpoint, permissions, stored drafts and concrete review; revokes without exposing credentials", async () => {
  client.connectionRequest.mockImplementation(async (path: string = "") =>
    path === "/drafts"
      ? {
          items: [
            {
              id: "draft",
              content: {
                subject: "Follow-up",
                text: "Saved draft text",
                to: ["office@example.com"],
                cc: [],
              },
              revision: "revision",
            },
          ],
          nextCursor: null,
        }
      : path === "/proposals"
        ? {
            items: [
              {
                id: "proposal",
                content_hash: "hash",
                content: {
                  profileName: "County Fair",
                  oldValues: { phone: "old" },
                  values: { phone: "new" },
                  sources: [],
                },
                approved_at: null,
              },
            ],
            nextCursor: null,
          }
        : path.includes("revoke")
          ? { revoked: true }
          : {
              enabled: true,
              endpoint: "https://app.example/api/chatgpt/mcp",
              csrfToken: "csrf-secret",
              clients: [],
              connections: [
                {
                  id: "connection",
                  client_id: "client",
                  scopes: ["crm:read"],
                  last_used_at: null,
                  revoked_at: null,
                },
              ],
            },
  );
  render(<SettingsChatGPTConnectionPage />);
  await screen.findByText("Saved draft text");
  expect(screen.getByText("https://app.example/api/chatgpt/mcp")).toBeTruthy();
  expect(screen.getByText("County Fair")).toBeTruthy();
  expect(screen.queryByText("csrf-secret")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
  await waitFor(() =>
    expect(client.connectionRequest).toHaveBeenCalledWith(
      "/connections/connection/revoke",
      {},
      "csrf-secret",
    ),
  );
});
it("hands split-host consent to the API without transferring the owner bearer", async () => {
  window.history.replaceState(
    {},
    "",
    "/chatgpt-connection/consent?interaction=bound",
  );
  client.connectionRequest.mockResolvedValue({
    endpoint: "https://api.example/api/chatgpt/mcp",
  });
  render(<ChatGPTConnectionConsentPage />);
  const link = await screen.findByRole("link", {
    name: "Continue to secure consent",
  });
  expect(link.getAttribute("href")).toBe(
    "https://api.example/chatgpt-connection/consent?interaction=bound",
  );
  expect(client.connectionRequest).toHaveBeenCalledWith();
});
it("loads a receipt outside the first page and continues through older drafts", async () => {
  window.history.replaceState({}, "", "/settings/chatgpt-connection?draft=old");
  const draft = (id: string) => ({
    id,
    content: { subject: id, text: "Body " + id, to: [], cc: [] },
  });
  client.connectionRequest.mockImplementation(async (path = "") =>
    path === "/drafts"
      ? { items: [draft("new")], nextCursor: "next" }
      : path === "/proposals"
        ? { items: [], nextCursor: null }
        : path === "/drafts/old"
          ? draft("old")
          : path === "/drafts?cursor=next"
            ? { items: [draft("old"), draft("older")], nextCursor: null }
            : {
                enabled: false,
                clients: [],
                connections: [],
                endpoint: "https://api.example/api/chatgpt/mcp",
              },
  );
  render(<SettingsChatGPTConnectionPage />);
  await screen.findByText("Body old");
  fireEvent.click(screen.getByRole("button", { name: "Older drafts" }));
  await screen.findByText("Body older");
  expect(screen.getAllByText("Body old")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Older drafts" })).toBeNull();
});
