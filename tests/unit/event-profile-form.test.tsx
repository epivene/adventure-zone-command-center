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
      contacts: [{ id: null, name: "Jordan Rivera", phone: "406-555-0199", email: "", role: "" }],
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
      contacts: [{ id: "contact-1", name: "", phone: "", email: "", role: "" }],
      booking: { enabled: false, name: "", nextActionKind: "call", nextActionDueAt: "" },
    });
    expect(routerPush).toHaveBeenCalledWith("/event-profiles/event-1");
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
});
