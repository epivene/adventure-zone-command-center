import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-token", () => ({
  apiGet: vi.fn(async () => ({})),
  apiPost: vi.fn(async () => ({})),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("./consolidation-dialog", () => ({ ConsolidationDialog: () => null }));

import { DuplicatesView, type DuplicateGroup } from "./duplicates-view";

const group: DuplicateGroup = {
  normalizedName: "Family Fun Day",
  city: "",
  region: "",
  classification: "ambiguous_location_candidate",
  groupKey: "family-fun-day",
  organizations: [
    { id: "org-1", name: "Family Fun Day (Idaho Falls) ID", city: "Idaho Falls", region: "ID", contactCount: 0, bookingCount: 0 },
    { id: "org-2", name: "Family Fun Day (Fishtail) MT", city: null, region: null, contactCount: 1, bookingCount: 0 },
    { id: "org-3", name: "Family Fun Day (Fishtail) MT", city: "Fishtail", region: "MT", contactCount: 1, bookingCount: 0 },
  ] as any,
};

describe("DuplicatesView merge selected", () => {
  it("offers merge selected duplicates for an ambiguous location group", () => {
    render(<DuplicatesView groups={[group]} onRefresh={vi.fn(async () => [group])} />);

    fireEvent.click(screen.getByLabelText("Include Family Fun Day (Idaho Falls) ID in this action"));
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();

    const primary = screen.getAllByLabelText(/Make Family Fun Day \(Fishtail\) MT primary/)[0];
    fireEvent.click(primary);

    expect(screen.getByRole("button", { name: "Merge selected duplicates" })).toBeEnabled();
  });
});
