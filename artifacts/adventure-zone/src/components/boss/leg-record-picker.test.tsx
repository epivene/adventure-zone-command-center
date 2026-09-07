import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LegRecordPicker,
  groupRecordsByLeg,
  recordsForLeg,
} from "./leg-record-picker";

const records = [
  { id: "receipt-a", legId: "leg-hulk", legName: "Hulk" },
  { id: "receipt-b", legId: "leg-hulk", legName: "Hulk" },
  { id: "receipt-c", legId: "leg-kristy", legName: "Kristy" },
  { id: "receipt-d", legId: null, legName: null },
];

afterEach(cleanup);

describe("leg-owned operational records", () => {
  it("groups records into their legs and keeps unassigned records visible", () => {
    expect(groupRecordsByLeg(records)).toEqual([
      { key: "leg-hulk", name: "Hulk", count: 2 },
      { key: "leg-kristy", name: "Kristy", count: 1 },
      { key: "unassigned", name: "Unassigned", count: 1 },
    ]);
    expect(
      recordsForLeg(records, "leg-hulk").map((record) => record.id),
    ).toEqual(["receipt-a", "receipt-b"]);
    expect(
      recordsForLeg(records, "unassigned").map((record) => record.id),
    ).toEqual(["receipt-d"]);
  });

  it("shows per-leg counts and reports the chosen leg", () => {
    const onSelect = vi.fn();
    render(
      <LegRecordPicker
        groups={groupRecordsByLeg(records)}
        noun="receipt"
        selectedLegKey={null}
        onSelect={onSelect}
      />,
    );

    expect(
      screen.getByText("Choose a leg to view receipts."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hulk, 2 receipts" }));
    expect(onSelect).toHaveBeenCalledWith("leg-hulk");
  });

  it("shows the selected leg with a clear way to change it", () => {
    const onSelect = vi.fn();
    render(
      <LegRecordPicker
        groups={groupRecordsByLeg(records)}
        noun="review"
        selectedLegKey="leg-kristy"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Kristy reviews")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change leg" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
