// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import {
  RenewalsSection,
  type RenewalSectionItem,
} from "./renewals-section";

afterEach(cleanup);

const baseItem: RenewalSectionItem = {
  id: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  primaryContactId: "20000000-0000-4000-8000-000000000001",
  name: "County Fair Renewal",
  status: "renewal_due",
  followUpId: "40000000-0000-4000-8000-000000000001",
  dueAt: new Date("2026-10-01T17:00:00.000Z"),
  attention: "later",
  operations: null,
};

function renderSection(
  renewals: RenewalSectionItem[],
  prominentCount = 0,
  error: string | null = null,
) {
  return render(
    <RenewalsSection
      error={error}
      prominentCount={prominentCount}
      renewals={renewals}
      total={renewals.length}
    />,
  );
}

describe("RenewalsSection", () => {
  it("keeps far-away renewals collapsed by default", () => {
    renderSection([baseItem]);

    expect(
      screen.getByRole("button", { name: /Next Season \/ Renewals \(1\)/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("County Fair Renewal")).not.toBeInTheDocument();
  });

  it("opens initially when a renewal is within 30 days", () => {
    renderSection(
      [{ ...baseItem, attention: "soon", dueAt: new Date("2026-08-30T17:00:00.000Z") }],
      1,
    );

    expect(
      screen.getByRole("button", { name: /Next Season \/ Renewals \(1\)/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1 renewal coming up soon")).toBeInTheDocument();
    expect(screen.getByText("Within 30 days")).toBeInTheDocument();
  });

  it("opens overdue renewals and labels them clearly", () => {
    renderSection(
      [{ ...baseItem, attention: "overdue", dueAt: new Date("2026-08-01T17:00:00.000Z") }],
      1,
    );

    expect(screen.getByText("1 renewal needs attention")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("keeps an undated renewal plan collapsed until opened manually", () => {
    renderSection([
      {
        ...baseItem,
        followUpId: null,
        dueAt: null,
        attention: "needs_plan",
      },
    ]);

    const toggle = screen.getByRole("button", {
      name: /Next Season \/ Renewals \(1\)/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByText("Needs renewal plan")).toBeInTheDocument();
  });

  it("respects a manual collapse after the initial auto-open", () => {
    const props = {
      error: null,
      prominentCount: 1,
      renewals: [
        { ...baseItem, attention: "soon" as const, dueAt: new Date("2026-08-30T17:00:00.000Z") },
      ],
      total: 1,
    };
    const view = render(<RenewalsSection {...props} />);
    const toggle = screen.getByRole("button", {
      name: /Next Season \/ Renewals \(1\)/,
    });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    view.rerender(<RenewalsSection {...props} />);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows an isolated renewal error without disabling the section header", () => {
    renderSection([], 0, "Could not load next-season renewals.");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load next-season renewals.",
    );
    expect(
      screen.getByRole("button", { name: /Next Season \/ Renewals \(0\)/ }),
    ).toBeEnabled();
  });
});
