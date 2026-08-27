// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiGet, apiPatch, apiPost, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPatch, apiPost, apiPut }));

import { ProfileInlineEditor } from "./profile-inline-editor";

const profile = {
  id: "profile-1",
  place: {
    name: "16th Street Fair (Denver) CO",
    description: "A downtown street fair with local vendors, food, music, and family activities.",
    phone: "7207277467",
    website: "https://example.com",
    address1: "1001 16th St",
    address2: null,
    city: "Denver",
    region: "CO",
    postalCode: "80202",
  },
  contacts: [
    { id: "contact-1", name: "Downtown Denver", role: "Organizer", phone: "7207277467", email: "coloradoevents@gmail.com", isPrimary: true },
    { id: "contact-2", name: "Jamie Reed", role: "Entertainment", phone: "3035550102", email: "jamie@example.com", isPrimary: false },
  ],
};

const contactDetail = {
  contact: {
    firstName: "Downtown",
    lastName: "Denver",
    organizationName: "",
    jobTitle: "Organizer",
    email: "coloradoevents@gmail.com",
    phone: "7207277467",
    address1: "",
    address2: "",
    city: "Denver",
    region: "CO",
    postalCode: "80202",
  },
  phones: [{ id: "phone-1", number: "7207277467", primary: true, label: "work" }],
};

const secondContactDetail = {
  contact: {
    firstName: "Jamie",
    lastName: "Reed",
    organizationName: "16th Street Fair (Denver) CO",
    jobTitle: "Entertainment",
    email: "jamie@example.com",
    phone: "3035550102",
    address1: "",
    address2: "",
    city: "Denver",
    region: "CO",
    postalCode: "80202",
  },
  phones: [{ id: "phone-2", number: "3035550102", primary: true, label: "work" }],
};

describe("ProfileInlineEditor", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiGet.mockImplementation((path: string) => path.includes("contact-2") ? Promise.resolve(secondContactDetail) : Promise.resolve(contactDetail));
    apiPatch.mockResolvedValue({ ok: true });
    apiPost.mockResolvedValue({ ok: true, contactId: "contact-new" });
    apiPut.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("saves a clean event description with the profile", async () => {
    render(<ProfileInlineEditor profile={profile as any} onSaved={vi.fn()} />);

    expect(screen.getByLabelText("Event description")).toHaveValue(
      "A downtown street fair with local vendors, food, music, and family activities.",
    );

    fireEvent.change(screen.getByLabelText("Event description"), {
      target: { value: "An annual downtown street fair featuring local vendors, food, live music, and family-friendly activities." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(
      "/event-profiles/profile-1/description",
      {
        description: "An annual downtown street fair featuring local vendors, food, live music, and family-friendly activities.",
      },
    ));
  });

  it("saves profile and selected contact through the existing APIs", async () => {
    const onSaved = vi.fn();
    render(<ProfileInlineEditor profile={profile as any} onSaved={onSaved} />);

    expect(screen.getByLabelText("Profile name")).toHaveValue("16th Street Fair (Denver) CO");
    expect(screen.getByLabelText("Website")).toHaveValue("https://example.com");
    await waitFor(() => expect(screen.getByLabelText("Phone")).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "16th Street Fair" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "3035551212" } });
    expect(screen.getByLabelText("Phone")).toHaveValue("3035551212");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/event-profiles/profile-1", expect.objectContaining({ name: "16th Street Fair" })));
    expect(apiPut).toHaveBeenCalledWith("/contacts/contact-1", expect.objectContaining({
      contact: expect.objectContaining({ phone: "3035551212", organizationName: "16th Street Fair" }),
      phones: [expect.objectContaining({ number: "3035551212", primary: true })],
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it("lets the user choose a different contact without leaving the profile", async () => {
    render(<ProfileInlineEditor profile={profile as any} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Phone")).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Contact to edit"), { target: { value: "contact-2" } });

    expect(await screen.findByDisplayValue("jamie@example.com")).toBeVisible();
    expect(apiGet).toHaveBeenCalledWith("/contacts/contact-2");
  });

  it("creates a new contact on the current profile without opening a separate contact page", async () => {
    const onSaved = vi.fn();
    render(<ProfileInlineEditor profile={profile as any} onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByLabelText("Phone")).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Taylor" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Morgan" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taylor@example.com" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "3035550199" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/contacts", expect.objectContaining({
      firstName: "Taylor",
      lastName: "Morgan",
      organizationName: "16th Street Fair (Denver) CO",
      email: "taylor@example.com",
      phone: "3035550199",
    })));
    expect(apiPut).toHaveBeenCalledWith("/contacts/contact-new/phones", {
      phones: [expect.objectContaining({ number: "3035550199", primary: true })],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("adds the first phone row when an existing contact did not have one", async () => {
    apiGet.mockResolvedValueOnce({
      contact: { ...contactDetail.contact, phone: "" },
      phones: [],
    });
    render(<ProfileInlineEditor profile={profile as any} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Phone")).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "3035550177" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith("/contacts/contact-1", expect.objectContaining({
      phones: [expect.objectContaining({ number: "3035550177", primary: true })],
    })));
  });

  it("cancels without saving", () => {
    const onCancel = vi.fn();
    render(<ProfileInlineEditor profile={profile as any} onSaved={vi.fn()} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(apiPatch).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("keeps entered values visible when save fails", async () => {
    apiPatch.mockRejectedValueOnce(new Error("Could not save profile"));
    render(<ProfileInlineEditor profile={profile as any} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Keep this value" } });
    await waitFor(() => expect(screen.getByLabelText("Phone")).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save profile");
    expect(screen.getByLabelText("Profile name")).toHaveValue("Keep this value");
  });
});
