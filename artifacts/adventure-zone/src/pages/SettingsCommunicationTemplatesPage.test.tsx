import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

import SettingsCommunicationTemplatesPage from "./SettingsCommunicationTemplatesPage";

describe("SettingsCommunicationTemplatesPage", () => {
  beforeEach(() => apiFetch.mockReset());

  it("groups Adventure Zone, shared, coordinator, and archived templates", async () => {
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
              ownerKind: "company",
              creatorDisplayName: null,
            },
            {
              id: "00000000-0000-4000-8000-000000000002",
              code: "shared_test",
              name: "Shared follow-up",
              channel: "email",
              category: "follow_up",
              subjectTemplate: "Following up",
              bodyTemplate: "Hi {{contactName}}",
              requiredPlaceholders: ["contactName"],
              accessScope: "office",
              state: "active",
              ownerKind: "shared_office",
              creatorDisplayName: "Amy",
            },
            {
              id: "00000000-0000-4000-8000-000000000003",
              code: "private_test",
              name: "Amy's private template",
              channel: "email",
              category: "custom",
              subjectTemplate: "Hello",
              bodyTemplate: "Hi {{contactName}}",
              requiredPlaceholders: ["contactName"],
              accessScope: "office",
              state: "active",
              ownerKind: "office_user",
              creatorDisplayName: "Amy",
            },
            {
              id: "00000000-0000-4000-8000-000000000004",
              code: "archived_test",
              name: "Old template",
              channel: "email",
              category: "custom",
              subjectTemplate: "Old",
              bodyTemplate: "Old",
              requiredPlaceholders: [],
              accessScope: "office",
              state: "archived",
              ownerKind: "office_user",
              creatorDisplayName: "Amy",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<SettingsCommunicationTemplatesPage />);

    for (const label of [
      "Adventure Zone Templates",
      "Shared Office Templates",
      "Coordinator Templates",
      "Archived",
    ]) await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());

    expect(screen.getByText("New event introduction")).toBeInTheDocument();
    expect(screen.getByText("Amy's private template")).toBeInTheDocument();
    expect(screen.getAllByText(/Amy/).length).toBeGreaterThan(0);
  });

  it("shows the promotion control for a coordinator template", async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ templates: [{
        id: "00000000-0000-4000-8000-000000000003",
        code: "private_test",
        name: "Amy's private template",
        channel: "email",
        category: "custom",
        subjectTemplate: "Hello",
        bodyTemplate: "Hi {{contactName}}",
        requiredPlaceholders: ["contactName"],
        accessScope: "office",
        state: "active",
        ownerKind: "office_user",
        creatorDisplayName: "Amy",
      }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    render(<SettingsCommunicationTemplatesPage />);
    await waitFor(() => expect(screen.getByText("Amy's private template")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Make shared template" })).toBeInTheDocument();
  });
});
