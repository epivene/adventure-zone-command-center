import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import SettingsChatGPTConnectionPage from "./SettingsChatGPTConnectionPage";
import { setAuthToken } from "@/lib/auth-token";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAuthToken(null);
});
it("recovers after network loss and displays saved app drafts without the assistant runtime", async () => {
  setAuthToken("owner.test");
  let offline = true;
  const fetch = vi.fn(async (input: any, options: any) => {
    if (offline) throw Error("Network unavailable");
    expect(options.headers.Authorization).toBe("Bearer owner.test");
    const url = String(input);
    const data = url.endsWith("/drafts")
      ? {
          items: [
            {
              id: "draft",
              content: {
                subject: "Saved elsewhere",
                text: "Still here after reconnect",
                to: ["office@example.com"],
                cc: [],
                organizationId: "profile",
              },
            },
          ],
          nextCursor: null,
        }
      : url.endsWith("/proposals")
        ? { items: [], nextCursor: null }
        : {
            enabled: false,
            endpoint: "https://app.example/api/chatgpt/mcp",
            csrfToken: "csrf",
            clients: [],
            connections: [],
          };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  render(<SettingsChatGPTConnectionPage />);
  await screen.findByRole("alert");
  offline = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh connection status" }),
  );
  await screen.findByText("Still here after reconnect");
  expect(screen.getByText(/Connection disabled/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  await waitFor(() => expect(fetch.mock.calls.length).toBe(6));
});
