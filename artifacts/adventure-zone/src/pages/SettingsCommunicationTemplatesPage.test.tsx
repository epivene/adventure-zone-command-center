import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

import SettingsCommunicationTemplatesPage from "./SettingsCommunicationTemplatesPage";

describe("SettingsCommunicationTemplatesPage", () => {
  beforeEach(() => apiFetch.mockReset());

  it("shows reviewed template wording and state", async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          templates: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              code: "new_event_intro",
              name: "New event introduction",
              channel: "email",
              category: "outreach",
              subjectTemplate: "The Adventure Zone for {{eventName}}",
              bodyTemplate: "Hi {{contactName}},\n\nThanks,\n{{senderName}}",
              requiredPlaceholders: ["contactName", "eventName", "senderName"],
              accessScope: "office",
              state: "active",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<SettingsCommunicationTemplatesPage />);

    await waitFor(() => expect(screen.getByText("New event introduction")).toBeInTheDocument());
    expect(screen.getByDisplayValue("The Adventure Zone for {{eventName}}")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
