// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { EventProfileForm } from "@/components/event-profiles/event-profile-form";

afterEach(() => {
  cleanup();
  routerPush.mockReset();
});

const events = [
  { id: "event-1", name: "Marias Fair", city: "Shelby", region: "MT" },
];
const contacts = [
  { id: "contact-1", name: "Avery Example", organizationName: "Marias Fair" },
];
const eventProfiles = {
  "event-1": {
    city: "Shelby",
    region: "MT",
    contacts: [{
      id: "contact-1", name: "Avery Example", phone: "406-555-0199",
      email: "avery@example.test", role: "Coordinator", isPrimary: true,
    }],
    bookings: [{ id: "booking-1", name: "Marias Fair 2026" }],
    followUps: [{ id: "follow-up-1", kind: "call" }],
    groups: [{ id: "group-1", name: "Annual partners" }],
  },
};

describe("EventProfileForm", () => {
  it("creates an event and a contact before optionally creating a booking", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      profileId: "created-event",
    });
    render(<EventProfileForm contacts={contacts} events={events} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Event name"), "Cascade Festival");
    await user.type(screen.getByLabelText("City"), "Helena");
    await user.type(screen.getByLabelText("State"), "MT");
    await user.type(screen.getByLabelText("Contact name"), "Jordan Rivera");
    await user.type(screen.getByLabelText("Phone"), "406-555-0199");
    await user.click(screen.getByLabelText("Create a booking for this event"));
    await user.type(screen.getByLabelText("Booking name"), "Cascade Festival 2026");
    fireEvent.change(screen.getByLabelText("Next follow-up date"), { target: { value: "2026-08-01" } });
    await user.click(screen.getByRole("button", { name: "Create event profile" }));

    expect(onSubmit).toHaveBeenCalledWith({
      event: { id: null, name: "Cascade Festival", city: "Helena", region: "MT" },
      contacts: [{ id: null, name: "Jordan Rivera", phone: "406-555-0199", email: "", role: "", primary: true }],
      booking: { enabled: true, name: "Cascade Festival 2026", nextActionKind: "call", nextActionDueAt: "2026-08-01" },
    });
    expect(routerPush).toHaveBeenCalledWith("/event-profiles/created-event");
  });

  it("uses selected existing event and contact without collecting duplicate identity fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, profileId: "event-1" });
    render(<EventProfileForm contacts={contacts} events={events} onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByLabelText("Find an existing event"), "event-1");
    await user.selectOptions(screen.getByLabelText("Add an existing contact"), "contact-1");
    await user.click(screen.getByRole("button", { name: "Create event profile" }));

    expect(onSubmit).toHaveBeenCalledWith({
      event: { id: "event-1", name: "", city: "", region: "" },
      contacts: [{ id: "contact-1", name: "Avery Example", phone: "", email: "", role: "", primary: true }],
      booking: { enabled: false, name: "", nextActionKind: "call", nextActionDueAt: "" },
    });
    expect(routerPush).toHaveBeenCalledWith("/event-profiles/event-1");
  });

  it("prefills an existing event's editable contact rows and submits their edits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, profileId: "event-1" });
    render(<EventProfileForm contacts={contacts} eventProfiles={eventProfiles} events={events} onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByLabelText("Find an existing event"), "event-1");

    expect(screen.getByLabelText("Contact name")).toHaveValue("Avery Example");
    expect(screen.getByLabelText("Phone")).toHaveValue("406-555-0199");
    expect(screen.getByLabelText("Email")).toHaveValue("avery@example.test");
    expect(screen.getByLabelText("Role (optional)")).toHaveValue("Coordinator");
    expect(screen.getByLabelText("Primary contact")).toBeChecked();
    expect(screen.getByText("Marias Fair 2026")).toBeInTheDocument();
    expect(screen.getByText("Annual partners")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Phone"));
    await user.type(screen.getByLabelText("Phone"), "406-555-0110");
    await user.click(screen.getByRole("button", { name: "Create event profile" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      event: { id: "event-1", name: "", city: "Shelby", region: "MT" },
      contacts: [{
        id: "contact-1", name: "Avery Example", phone: "406-555-0110",
        email: "avery@example.test", role: "Coordinator", primary: true,
      }],
    }));
  });

  it("submits every added contact so the server can persist all event relationships", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, profileId: "event-1" });
    render(<EventProfileForm contacts={contacts} events={events} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Contact name"), "Jordan Rivera");
    await user.click(screen.getByRole("button", { name: "Add another contact" }));
    await user.type(screen.getByLabelText("Contact 2 name"), "Bailey Stone");
    await user.click(screen.getByRole("button", { name: "Create event profile" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ contacts: [
      expect.objectContaining({ name: "Jordan Rivera" }),
      expect.objectContaining({ name: "Bailey Stone" }),
    ] }));
  });

  it("does not offer an already selected contact in a second contact row", async () => {
    const user = userEvent.setup();
    render(<EventProfileForm contacts={contacts} events={events} onSubmit={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Add an existing contact"), "contact-1");
    await user.click(screen.getByRole("button", { name: "Add another contact" }));
    expect(screen.getByRole("combobox", { name: "Contact 2 existing contact" })).not.toContainHTML('value="contact-1"');
  });
});
