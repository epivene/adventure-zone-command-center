import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { InvoiceContractWorkspaceCard } from "./invoice-contract-workspace-card";

describe("InvoiceContractWorkspaceCard", () => {
  it("opens the single invoices and contracts workspace without presenting another attention queue", () => {
    const { hook } = memoryLocation({ path: "/today" });

    render(
      <Router hook={hook}>
        <InvoiceContractWorkspaceCard />
      </Router>,
    );

    expect(screen.getByRole("heading", { name: "Invoices & Contracts" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", "/invoices-contracts");
    expect(screen.getByText(/invoices, deposits, balances, and signed contracts/i)).toBeVisible();
    expect(screen.queryByText(/contracts needing attention/i)).not.toBeInTheDocument();
  });
});
