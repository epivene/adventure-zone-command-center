import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-token", () => ({
  apiGet: vi.fn(async () => ({})),
  apiPost: vi.fn(async () => ({})),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("./consolidation-dialog", () => ({
  ConsolidationDialog: ({ sourceOrgIds }: { sourceOrgIds: string[] }) => (
    <div data-testid="consolidation-selection">{sourceOrgIds.join(",")}</div>
  ),
}));

import { DuplicatesView, type DuplicateGroup } from "./duplicates-view";

const group: DuplicateGroup = {
  normalizedName: "Family Fun Day",
  city: "",
  region: "",
  classification: "ambiguous_location_candidate",
  groupKey: "family-fun-day",
  candidateIds: ["org-1", "org-2", "org-3"],
  evidence: [{ family: "name", label: "same base name" }],
  organizations: [
    { id: "org-1", name: "Family Fun Day (Idaho Falls) ID", city: "Idaho Falls", region: "ID", contactCount: 0, bookingCount: 0 },
    { id: "org-2", name: "Family Fun Day (Fishtail) MT", city: null, region: null, contactCount: 1, bookingCount: 0 },
    { id: "org-3", name: "Family Fun Day (Fishtail) MT", city: "Fishtail", region: "MT", contactCount: 1, bookingCount: 0 },
  ] as any,
};

describe("DuplicatesView subset review", () => {
  it("lets the reviewer apply an action to only two records in a three-record suggestion", () => {
    render(<DuplicatesView groups={[group]} onRefresh={vi.fn(async () => [group])} />);

    fireEvent.click(screen.getByLabelText("Include Family Fun Day (Idaho Falls) ID in this action"));
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Organization locations" }));
    expect(screen.getByTestId("consolidation-selection")).toHaveTextContent("org-2,org-3");
    expect(screen.getByTestId("consolidation-selection")).not.toHaveTextContent("org-1");
  });

  it("opens each candidate profile in a new tab for inspection", () => {
    render(<DuplicatesView groups={[group]} onRefresh={vi.fn(async () => [group])} />);

    const link = screen.getByRole("link", { name: "Open Family Fun Day (Fishtail) MT profile" });
    expect(link).toHaveAttribute("href", "/profiles/org-2");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
