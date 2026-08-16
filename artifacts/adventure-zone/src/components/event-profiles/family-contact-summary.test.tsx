// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FamilyContactSummary } from "./family-contact-summary";

afterEach(cleanup);

const shared = {
  familyId: "family-1",
  familyName: "Water Lantern Festival",
  website: "waterlanternfestival.com",
  primaryContact: { contactId: "contact-1", name: "Jane Smith", role: "Corporate Events", phone: "701-555-0101", email: "jane@example.com" },
};

describe("FamilyContactSummary", () => {
  it("renders family contact data read-only with safe website and family links", () => {
    render(<FamilyContactSummary shared={shared} />);
    expect(screen.getByText("Family contact — Water Lantern Festival")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Corporate Events")).toBeInTheDocument();
    expect(screen.getByText(/701-555-0101/)).toBeInTheDocument();
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Family website" })).toHaveAttribute("href", "https://waterlanternfestival.com/");
    expect(screen.getByRole("link", { name: "Open family" })).toHaveAttribute("href", "/event-families/family-1");
    expect(screen.queryByRole("button", { name: /Edit|Remove|Primary/ })).not.toBeInTheDocument();
  });

  it("renders website-only or contact-only data and renders nothing for null", () => {
    const { rerender } = render(<FamilyContactSummary shared={{ ...shared, primaryContact: null }} />);
    expect(screen.getByRole("link", { name: "Family website" })).toBeInTheDocument();
    rerender(<FamilyContactSummary shared={{ ...shared, website: null }} />);
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    rerender(<FamilyContactSummary shared={null} />);
    expect(screen.queryByText(/Family contact/)).not.toBeInTheDocument();
  });
});
