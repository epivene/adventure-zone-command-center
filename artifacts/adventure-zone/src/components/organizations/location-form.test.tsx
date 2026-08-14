import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocationForm } from "./location-form";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

describe("LocationForm travel leg", () => {
  afterEach(cleanup);

  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true });
  });

  it("creates a location with its selected planning leg", async () => {
    const onSuccess = vi.fn();
    render(
      <LocationForm
        orgId="org-1"
        onClose={vi.fn()}
        onSuccess={onSuccess}
        travelLegs={[{ id: "leg-north", name: "Northern route", color: "#f97316" }]}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: "Denver, CO" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Travel leg/ }), { target: { value: "leg-north" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [, request] = apiFetch.mock.calls[0]!;
    expect(JSON.parse(request.body)).toMatchObject({
      label: "Denver, CO",
      travelLegId: "leg-north",
    });
  });

  it("can clear a location planning leg without touching bookings", async () => {
    render(
      <LocationForm
        orgId="org-1"
        initial={{ id: "loc-1", label: "Denver, CO", travelLegId: "leg-north" }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        travelLegs={[{ id: "leg-north", name: "Northern route", color: "#f97316" }]}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: /Travel leg/ }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(JSON.parse(apiFetch.mock.calls[0]![1].body)).toMatchObject({ travelLegId: null });
  });
});
