import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

import SettingsCommunicationTemplatesPage from "./SettingsCommunicationTemplatesPage";

describe("SettingsCommunicationTemplatesPage", () => {
  beforeEach(() => {
    cleanup();
    apiFetch.mockReset();
  });

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
    ]) await waitFor(() => expect(screen.getByRole("heading", { name: label })).toBeInTheDocument());

    expect(screen.getAllByText("New event introduction").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Amy's private template").length).toBeGreaterThan(0);
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
    await waitFor(() => expect(screen.getAllByText("Amy's private template").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Make shared template" })).toBeInTheDocument();
  });

  it("creates a durable reusable template as a draft", async () => {
    const created = {
      id: "00000000-0000-4000-8000-000000000005",
      code: "proposal_follow_up",
      name: "Proposal follow-up",
      channel: "email",
      category: "Sales",
      subjectTemplate: "Following up, {{contactName}}",
      bodyTemplate: "Hi {{contactName}},\n\nWould you like to talk?",
      requiredPlaceholders: ["contactName"],
      accessScope: "owner",
      state: "draft",
      ownerKind: "company",
      creatorDisplayName: null,
    };
    apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ template: created }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [created] }), { status: 200 }));

    render(<SettingsCommunicationTemplatesPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /New reusable template/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /New reusable template/ }));
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Proposal follow-up" } });
    fireEvent.change(screen.getByLabelText(/Template code/), { target: { value: "Proposal Follow Up" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Following up, {{contactName}}" } });
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi {{contactName}},\n\nWould you like to talk?" } });
    fireEvent.click(screen.getByLabelText("{{contactName}}"));
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/communication-templates",
      expect.objectContaining({ method: "POST" }),
    ));
    const payload = JSON.parse(apiFetch.mock.calls[1][1].body);
    expect(payload).toMatchObject({
      code: "proposal_follow_up",
      name: "Proposal follow-up",
      category: "Sales",
      bodyTemplate: "Hi {{contactName}},\n\nWould you like to talk?",
      requiredPlaceholders: ["contactName"],
      accessScope: "owner",
    });
    await waitFor(() => expect(screen.getByText('Created "Proposal follow-up" as a draft. Review it before activating.')).toBeInTheDocument());
  });
});
