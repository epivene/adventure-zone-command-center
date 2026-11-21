import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AdminCommandPanelPage from "./AdminCommandPanelPage";

describe("simplified Command Panel", () => {
  it("offers only Booking and Admin Tools", () => {
    render(<AdminCommandPanelPage />);
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/today", "/settings"]);
    expect(screen.getByRole("heading", { name: "Booking" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Admin Tools" })).toBeInTheDocument();
    expect(screen.queryByText(/Marketing|Legs & Operations|ACT recovery/)).not.toBeInTheDocument();
  });
});
