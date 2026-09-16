// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TravelLegManagerCards, YearEndInspectionLegSummary } from "./travel-leg-manager-cards";

const legs = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Kristy", color: "#f97316", sortOrder: 1, baseAddress: "Killdeer, ND", defaultVehicleName: "Box truck", defaultMpg: 9, archivedAt: null },
  { id: "00000000-0000-4000-8000-000000000002", name: "Hulk", color: "#22c55e", sortOrder: 2, baseAddress: "", defaultVehicleName: "", defaultMpg: null, archivedAt: null },
] as any;

function props() {
  return {
    legs,
    legResources: [{ legId: legs[0].id, id: "r1", code: "PB", name: "Paintball trailer", category: "trailer" }],
    managerAccess: [{ legId: legs[0].id, legName: "Kristy", archivedAt: null, enabled: true, sessionVersion: 1 }],
    onSaveLeg: vi.fn(async (id: string, input: any) => ({ ok: true as const, leg: { ...legs.find((leg: any) => leg.id === id), ...input, defaultMpg: Number(input.defaultMpg) || null } })),
    onSaveOrder: vi.fn(async () => ({ ok: true as const, legs })),
    onAdd: vi.fn(async () => {}),
    onArchive: vi.fn(async () => {}),
    onRestore: vi.fn(async () => {}),
    onSetManagerPassword: vi.fn(async () => {}),
    onSignOutManagerDevices: vi.fn(async () => {}),
  };
}

afterEach(cleanup);

describe("TravelLegManagerCards", () => {
  it("shows simple collapsed summaries by default", () => {
    render(<TravelLegManagerCards {...props()} />);
    expect(screen.getByText("Kristy")).toBeInTheDocument();
    expect(screen.getByText(/Manager enabled · Box truck · 1 resource/)).toBeInTheDocument();
    expect(screen.getByText("Hulk")).toBeInTheDocument();
    expect(screen.queryByLabelText("Manager / Leg name")).not.toBeInTheDocument();
  });

  it("expands one leg to reveal all configuration controls", () => {
    render(<TravelLegManagerCards {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /Kristy/ }));
    expect(screen.getByLabelText("Manager / Leg name")).toHaveValue("Kristy");
    expect(screen.getByLabelText(/base address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default vehicle/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default MPG/i)).toBeInTheDocument();
    expect(screen.getByText("Paintball trailer")).toBeInTheDocument();
    expect(screen.getByText("Manager portal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("keeps reordering in a dedicated mode", () => {
    render(<TravelLegManagerCards {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reorder legs" }));
    expect(screen.getByRole("button", { name: "Done reordering" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move leg 1 down" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Manager / Leg name")).not.toBeInTheDocument();
  });
});


describe("YearEndInspectionLegSummary", () => {
  it("shows inspection progress and repair attention", () => {
    render(<YearEndInspectionLegSummary summary={{ inspected: 42, total: 58, needsAttention: 6, status: "in_progress" }} />);
    expect(screen.getByText("42 of 58 inspected")).toBeVisible();
    expect(screen.getByText("6 need repair")).toBeVisible();
  });
});

