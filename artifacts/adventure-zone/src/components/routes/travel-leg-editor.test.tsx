// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TravelLegEditor } from "./travel-leg-editor";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

function leg(
  id: string,
  sortOrder: number,
  archivedAt: Date | null = null,
  name = `Leg ${sortOrder}`,
): TravelLeg {
  return {
    id,
    name,
    color: "#6B7280",
    sortOrder,
    archivedAt,
    baseAddress: null,
    defaultVehicleName: null,
    defaultMpg: null,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TravelLegEditor lifecycle", () => {
  it("allows adding after nine active legs", () => {
    const onAdd = vi.fn(async () => undefined);
    render(
      <TravelLegEditor
        legs={Array.from({ length: 9 }, (_, index) => leg(`leg-${index + 1}`, index + 1))}
        onSaveLeg={vi.fn()}
        onSaveOrder={vi.fn()}
        onAdd={onAdd}
      />,
    );

    const add = screen.getByRole("button", { name: "Add leg" });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("hides archived legs until View Archived is selected", () => {
    render(
      <TravelLegEditor
        legs={[leg("active", 1), leg("archived", 2, new Date("2026-01-01T00:00:00Z"))]}
        onSaveLeg={vi.fn()}
        onSaveOrder={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Archived travel legs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /View Archived/ }));
    expect(screen.getByLabelText("Archived travel legs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore leg Leg 2" })).toBeInTheDocument();
  });

  it("does not render permanent deletion as the normal lifecycle", () => {
    render(
      <TravelLegEditor
        legs={[leg("one", 1), leg("two", 2)]}
        onSaveLeg={vi.fn()}
        onSaveOrder={vi.fn()}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Delete leg/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Archive leg/ })).toHaveLength(2);
  });

  it("shows manager access inside the matching travel-leg card", () => {
    render(
      <TravelLegEditor
        legs={[leg("leg-kristy", 1, null, "Kristy")]}
        managerAccess={[{
          legId: "leg-kristy",
          legName: "Kristy",
          archivedAt: null,
          enabled: true,
          sessionVersion: 3,
        }]}
        onSaveLeg={vi.fn()}
        onSaveOrder={vi.fn()}
        onSetManagerPassword={vi.fn(async () => undefined)}
        onSignOutManagerDevices={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByLabelText("Manager / Leg name")).toHaveValue("Kristy");
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Out All Devices" })).toBeInTheDocument();
  });

  it("saves a manager/leg rename without requiring a portal password", async () => {
    const onSaveLeg = vi.fn(async (_id, input) => ({
      ok: true as const,
      leg: {
        ...leg("leg-kristy", 1, null, "Kris"),
        name: input.name,
      },
    }));
    const onSetManagerPassword = vi.fn(async () => undefined);

    render(
      <TravelLegEditor
        legs={[leg("leg-kristy", 1, null, "Kristy")]}
        managerAccess={[{
          legId: "leg-kristy",
          legName: "Kristy",
          archivedAt: null,
          enabled: true,
          sessionVersion: 3,
        }]}
        onSaveLeg={onSaveLeg}
        onSaveOrder={vi.fn()}
        onSetManagerPassword={onSetManagerPassword}
      />,
    );

    fireEvent.change(screen.getByLabelText("Manager / Leg name"), {
      target: { value: "Kris" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save leg" }));

    await waitFor(() => expect(onSaveLeg).toHaveBeenCalledWith(
      "leg-kristy",
      expect.objectContaining({ name: "Kris" }),
    ));
    expect(onSetManagerPassword).not.toHaveBeenCalled();
  });

  it("keeps portal passwords write-only", async () => {
    const onSetManagerPassword = vi.fn(async () => undefined);
    render(
      <TravelLegEditor
        legs={[leg("leg-kristy", 1, null, "Kristy")]}
        managerAccess={[{
          legId: "leg-kristy",
          legName: "Kristy",
          archivedAt: null,
          enabled: true,
          sessionVersion: 3,
        }]}
        onSaveLeg={vi.fn()}
        onSaveOrder={vi.fn()}
        onSetManagerPassword={onSetManagerPassword}
      />,
    );

    const password = screen.getByLabelText("New password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(onSetManagerPassword).toHaveBeenCalledWith("leg-kristy", "new-secret"));
    expect(password.value).toBe("");
  });

  it("requires confirmation before signing out all devices", async () => {
    const onSignOutManagerDevices = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <TravelLegEditor
        legs={[leg("leg-kristy", 1, null, "Kristy")]}
        managerAccess={[{
          legId: "leg-kristy",
          legName: "Kristy",
          archivedAt: null,
          enabled: true,
          sessionVersion: 3,
        }]}
        onSaveLeg={vi.fn()}
        onSaveOrder={vi.fn()}
        onSignOutManagerDevices={onSignOutManagerDevices}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign Out All Devices" }));
    expect(onSignOutManagerDevices).not.toHaveBeenCalled();
  });
});
