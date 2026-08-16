// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManualHandoffForm } from "./manual-handoff-form";

const post = vi.hoisted(() => vi.fn(async () => ({ handoff: { id: "m1" } })));
vi.mock("@/lib/auth-token", () => ({ apiPost: post }));

const legs = [
  { id: "00000000-0000-4000-8000-000000000010", name: "Kristy", color: "#f97316", sortOrder: 1, archivedAt: null },
  { id: "00000000-0000-4000-8000-000000000020", name: "Hulk", color: "#22c55e", sortOrder: 2, archivedAt: null },
] as any;
const resources = [{ id: "00000000-0000-4000-8000-000000000030", code: "PB", name: "Paintball trailer" }];

describe("ManualHandoffForm", () => {
  it("submits an outside runner without creating a fake leg", async () => {
    render(<ManualHandoffForm travelLegs={legs} resources={resources} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("From leg"), { target: { value: legs[0].id } });
    fireEvent.click(screen.getByLabelText("Outside person / runner"));
    fireEvent.change(screen.getByLabelText("Runner name"), { target: { value: "Jordan Smith" } });
    fireEvent.change(screen.getByLabelText("Runner phone"), { target: { value: "555-0100" } });
    fireEvent.change(screen.getByLabelText("Equipment"), { target: { value: resources[0].id } });
    fireEvent.change(screen.getByLabelText("Meetup location"), { target: { value: "Billings transfer" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "45.7833" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-108.5007" } });
    fireEvent.change(screen.getByLabelText("Meetup starts"), { target: { value: "2026-08-20T12:00" } });
    fireEvent.change(screen.getByLabelText("Meetup ends"), { target: { value: "2026-08-20T14:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule meetup" }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/handoffs/manual", expect.objectContaining({
      fromParticipant: { kind: "leg", legId: legs[0].id },
      toParticipant: expect.objectContaining({ kind: "external_contact", displayName: "Jordan Smith", phone: "555-0100" }),
      resourceId: resources[0].id,
    }));
  });
});
