import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileSearchResults } from "./profile-search-results";

const result = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "organization" as const,
  label: "Morton County Fair",
  secondaryLabel: "Fair Board",
  city: "Mandan",
  region: "ND",
  status: "possible",
  lastContactAt: null,
  bookingCount: 4,
  matchedOn: ["name", "city"],
};

describe("ProfileSearchResults", () => {
  it("renders structured profile details and both actions", () => {
    const onUseContext = vi.fn();
    const onOpenProfile = vi.fn();
    render(<ProfileSearchResults results={[result]} onUseContext={onUseContext} onOpenProfile={onOpenProfile} />);

    expect(screen.getByText("Morton County Fair")).toBeTruthy();
    expect(screen.getByText(/Mandan, ND/)).toBeTruthy();
    expect(screen.getByText(/Matched on name, city/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use as context" }));
    expect(onUseContext).toHaveBeenCalledWith(result);
    fireEvent.click(screen.getByRole("button", { name: "Open profile" }));
    expect(onOpenProfile).toHaveBeenCalledWith(result);
  });
});
