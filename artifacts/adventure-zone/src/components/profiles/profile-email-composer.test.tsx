import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn() }));
vi.mock("@/lib/auth-token", () => api);
import { ProfileEmailComposer, ProfileEmailDrafts } from "./profile-email-composer";
const draft = { id: "draft-1", organizationId: "profile-1", contactId: "contact-1", recipientEmail: "fair@example.org", subject: "Next year's fair", body: "Hello Kellie", state: "draft" };
const props = { organizationId: "profile-1", profileName: "County Fair", contacts: [{ id: "contact-1", name: "Kellie", email: "fair@example.org" }], draft: null, onClose: vi.fn(), onSaved: vi.fn() };
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); api.apiPost.mockResolvedValue({ draft }); api.apiGet.mockResolvedValue({ drafts: [draft] }); });
describe("Booking email composer", () => {
  it("previews and saves a profile-linked draft using owner authentication", async () => {
    render(<ProfileEmailComposer {...props} />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: draft.subject } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: draft.body } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Email" }));
    expect(screen.getByRole("region", { name: "Email preview" }).textContent).toContain("Hello Kellie");
    expect(api.apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(draft));
    expect(api.apiPost).toHaveBeenCalledExactlyOnceWith("/office-admin/email-drafts", { organizationId: "profile-1", contactId: "contact-1", subject: draft.subject, body: draft.body });
    expect(screen.queryByRole("button", { name: /send|submit/i })).toBeNull();
  });
  it("reopens saved drafts and updates them without creating a duplicate", async () => {
    const onEdit = vi.fn();
    const view = render(<ProfileEmailDrafts organizationId="profile-1" revision={0} onCreate={vi.fn()} onEdit={onEdit} />);
    fireEvent.click(await screen.findByRole("button", { name: /Next year's fair/ }));
    expect(onEdit).toHaveBeenCalledWith(draft);
    view.unmount();
    api.apiPatch.mockResolvedValue({ draft: { ...draft, body: "Updated" } });
    render(<ProfileEmailComposer {...props} draft={draft} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledWith("/office-admin/email-drafts/draft-1", { subject: draft.subject, body: "Updated" }));
    expect(api.apiPost).not.toHaveBeenCalled();
  });
  it("opens the requested active draft from a profile email deep link", async () => {
    const onEdit = vi.fn();
    const onDraftOpened = vi.fn();
    const view = render(
      <ProfileEmailDrafts
        organizationId="profile-1"
        revision={0}
        onCreate={vi.fn()}
        onEdit={onEdit}
        openDraftId={draft.id}
        onDraftOpened={onDraftOpened}
      />,
    );

    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(draft));
    expect(onDraftOpened).toHaveBeenCalledOnce();
  });
  it("does not offer editing when a linked draft is no longer editable", async () => {
    const scheduledDraft = { ...draft, state: "scheduled" };
    api.apiGet.mockResolvedValue({ drafts: [scheduledDraft] });
    const onEdit = vi.fn();
    const onDraftOpened = vi.fn();
    const view = render(
      <ProfileEmailDrafts
        organizationId="profile-1"
        revision={0}
        onCreate={vi.fn()}
        onEdit={onEdit}
        openDraftId={scheduledDraft.id}
        onDraftOpened={onDraftOpened}
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "This draft is no longer editable from the profile.",
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDraftOpened).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Next year's fair/ })).not.toBeInTheDocument();
    view.rerender(
      <ProfileEmailDrafts
        organizationId="profile-1"
        revision={0}
        onCreate={vi.fn()}
        onEdit={onEdit}
        onDraftOpened={onDraftOpened}
      />,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "This draft is no longer editable from the profile.",
    );
  });
  it("explains missing recipient emails and preserves text after save errors", async () => {
    const view = render(<ProfileEmailComposer {...props} contacts={[]} />);
    expect(screen.getByRole("status").textContent).toContain("Add an email address");
    expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
    view.unmount();
    api.apiPost.mockRejectedValue(new Error("Could not save"));
    render(<ProfileEmailComposer {...props} />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: draft.subject } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: draft.body } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByLabelText("Email")).toHaveValue(draft.body);
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});

it("uses the Boss draft loader and preserves the shared layout while hiding write controls", async () => {
  const getDrafts = vi.fn(async () => ({ drafts: [draft] }));
  const onEdit = vi.fn();
  render(<ProfileEmailDrafts organizationId="profile-1" revision={0} readOnly getDrafts={getDrafts} onCreate={vi.fn()} onEdit={onEdit} />);
  expect(await screen.findByText("Hello Kellie")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Email drafts" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create Email" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Next year's fair/ }));
  expect(onEdit).not.toHaveBeenCalled();
  expect(api.apiGet).not.toHaveBeenCalled();
});
