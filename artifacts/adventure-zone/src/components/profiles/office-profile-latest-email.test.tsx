// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfficeProfileLatestEmail } from "./office-profile-latest-email";

describe("Office profile latest email", () => {
  it("shows the latest account-scoped draft and links to that draft in Office Emails", () => {
    render(<OfficeProfileLatestEmail profileId="profile & one" draft={{
      id: "draft/123",
      subject: "Updated event details",
      recipientEmail: "organizer@example.org",
      state: "submitted",
      updatedAt: "2026-10-08T12:00:00.000Z",
    }} />);

    expect(screen.getByTestId("office-profile-latest-email")).toHaveTextContent("Updated event details");
    expect(screen.getByTestId("office-profile-latest-email")).toHaveTextContent("Awaiting review — not sent");
    const url = new URL(screen.getByRole("link", { name: "Open email" }).getAttribute("href")!, "https://example.org");
    expect(url.pathname).toBe("/office/emails");
    expect(url.searchParams.get("draftId")).toBe("draft/123");
    expect(url.searchParams.has("profileId")).toBe(false);
  });

  it("offers the Office email workspace without inventing an email when none is linked", () => {
    render(<OfficeProfileLatestEmail profileId="profile-1" draft={null} />);

    expect(screen.getByText("No profile emails yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Draft Email" })).toHaveAttribute("href", "/office/emails?profileId=profile-1");
  });

  it("distinguishes a pending profile-email lookup from an empty history", () => {
    render(<OfficeProfileLatestEmail profileId="profile-1" draft={null} loading />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading profile emails");
    expect(screen.queryByText("No profile emails yet.")).not.toBeInTheDocument();
  });
});
