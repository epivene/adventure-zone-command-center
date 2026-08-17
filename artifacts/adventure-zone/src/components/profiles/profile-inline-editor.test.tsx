// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPut = vi.fn();

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPatch, apiPut }));

import { ProfileInlineEditor } from "./profile-inline-editor";

const profile = {
  id: "profile-1",
  place: {
    name: "16th Street Fair (Denver) CO",
    phone: "7207277467",
    website: "https://example.com",
    address1: "1001 16th St",
    address2: null,
    city: "Denver",
    region: "CO",
    postalCode: "80202",
  },
  contacts: [{ id: "contact-1", name: "Downtown Denver", role: "Organizer", phone: "7207277467", email: "coloradoevents@gmail.com", isPrimary: true }],
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

describe("ProfileInlineEditor", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPut.mockReset();
    apiGet.mockResolvedValue(contactDetail);
    apiPatch.mockResolvedValue({ ok: true });
    apiPut.mockResolvedValue({ ok: true });
  });

  it("saves profile and selected contact through the existing APIs", async () => {
    const onSaved = vi.fn();
    render(<ProfileInlineEditor profile={profile as any} onSaved={onSaved} />);

    expect(screen.getByLabelText("Profile name")).toHaveValue("16th Street Fair (Denver) CO");
    expect(screen.getByLabelText("Website")).toHaveValue("https://example.com");
    await screen.findByDisplayValue("coloradoevents@gmail.com");

    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "16th Street Fair" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "3035551212" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/event-profiles/profile-1", expect.objectContaining({ name: "16th Street Fair" })));
    expect(apiPut).toHaveBeenCalledWith("/contacts/contact-1", expect.objectContaining({
      contact: expect.objectContaining({ phone: "3035551212" }),
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it("cancels without saving", async () => {
    const onCancel = vi.fn();
    render(<ProfileInlineEditor profile={profile as any} onSaved={vi.fn()} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(apiPatch).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("keeps entered values visible when save fails", async () => {
    apiPatch.mockRejectedValueOnce(new Error("Could not save profile"));
    render(<ProfileInlineEditor profile={profile as any} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Keep this value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save profile");
    expect(screen.getByLabelText("Profile name")).toHaveValue("Keep this value");
  });
});
