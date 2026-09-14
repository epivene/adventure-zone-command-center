import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

const legacyTemplate = {
  id: "7c62115c-38a9-4eb9-9fb4-44c37d88982a",
  code: "returning_event",
  name: "Returning Event",
  channel: "email",
  category: "Outreach",
  subjectTemplate: "Planning {{eventName}}",
  bodyTemplate: '<table role="presentation" width="640"><tbody><tr><td style="background:#f8f6f1;padding:38px"><div style="font-size:16px">Hi {{contactName}},</div></td></tr></tbody></table>',
  bodyFormat: "html",
  editorDocument: null,
  editorDocumentVersion: null,
  requiredPlaceholders: ["contactName", "eventName"],
  accessScope: "owner",
  state: "draft",
  ownerKind: "company",
  creatorDisplayName: null,
};

describe("SettingsCommunicationTemplatesPage visual builder", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ templates: [legacyTemplate] }), { status: 200 }));
  });

  it("opens legacy HTML in the visual builder without saving merely by opening", async () => {
    const Page = (await import("./SettingsCommunicationTemplatesPage")).default;
    render(<Page />);

    const canvas = await screen.findByRole("region", { name: "Email canvas" });
    expect(within(canvas).getByText("Text")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("creates a new branded visual draft", async () => {
    apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [legacyTemplate] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ template: { ...legacyTemplate, id: "f9e674f8-7a66-4c0a-a92d-238a3d69d144", name: "Convention follow-up", editorDocument: { version: 1, settings: { backgroundColor: "#f8f6f1", contentWidth: 640 }, blocks: [] } } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [legacyTemplate] }), { status: 200 }));
    const Page = (await import("./SettingsCommunicationTemplatesPage")).default;
    render(<Page />);
    await screen.findByRole("heading", { name: "Returning Event" });

    fireEvent.click(screen.getByRole("button", { name: /New reusable template/i }));
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Convention follow-up" } });
    fireEvent.change(screen.getByLabelText("Template code"), { target: { value: "convention_follow_up" } });
    fireEvent.click(screen.getByRole("button", { name: "Adventure Zone branded" }));
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/communication-templates", expect.objectContaining({ method: "POST" })));
    const createCall = apiFetch.mock.calls.find((call) => call[0] === "/communication-templates" && call[1]?.method === "POST");
    const body = JSON.parse(createCall?.[1]?.body as string);
    expect(body.bodyFormat).toBe("html");
    expect(body.editorDocument.blocks.map((block: { type: string }) => block.type)).toEqual(expect.arrayContaining(["logoHeader", "hero", "packageCards", "offerCallout", "footer"]));
  });

  it("saves an imported legacy email as a visual document", async () => {
    apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [legacyTemplate] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ template: legacyTemplate }), { status: 200 }));
    const Page = (await import("./SettingsCommunicationTemplatesPage")).default;
    render(<Page />);

    await screen.findByRole("region", { name: "Email canvas" });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Hi {{contactName}}, welcome back!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining(legacyTemplate.id), expect.objectContaining({ method: "PATCH" })));
    const saveCall = apiFetch.mock.calls.find((call) => call[1]?.method === "PATCH");
    const body = JSON.parse(saveCall?.[1]?.body as string);
    expect(body.editorDocument.blocks[0]).toMatchObject({ type: "text", content: "Hi {{contactName}}, welcome back!" });
    expect(body).not.toHaveProperty("bodyTemplate");
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("asks before leaving a template with visual edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const Page = (await import("./SettingsCommunicationTemplatesPage")).default;
    render(<Page />);

    await screen.findByRole("region", { name: "Email canvas" });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Unsaved change" } });
    await screen.findByText("Unsaved");
    fireEvent.click(screen.getByRole("button", { name: /New reusable template/i }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Template name")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("keeps plain-text templates plain until conversion is explicitly requested", async () => {
    const plainTemplate = { ...legacyTemplate, id: "80d5a745-62a2-4aa8-825f-c0bc42a55a5a", bodyTemplate: "Hi {{contactName}}", bodyFormat: "plain_text", editorDocument: null };
    apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [plainTemplate] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ template: plainTemplate }), { status: 200 }));
    const Page = (await import("./SettingsCommunicationTemplatesPage")).default;
    render(<Page />);

    expect(await screen.findByLabelText("Plain-text body")).toHaveValue("Hi {{contactName}}");
    expect(screen.queryByRole("region", { name: "Email canvas" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining(plainTemplate.id), expect.objectContaining({ method: "PATCH" })));
    const body = JSON.parse(apiFetch.mock.calls.find((call) => call[1]?.method === "PATCH")?.[1]?.body as string);
    expect(body).toMatchObject({ bodyFormat: "plain_text", bodyTemplate: "Hi {{contactName}}" });
    expect(body).not.toHaveProperty("editorDocument");
  });
});
