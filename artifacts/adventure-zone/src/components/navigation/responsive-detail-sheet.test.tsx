import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ResponsiveDetailSheet } from "./responsive-detail-sheet";

describe("ResponsiveDetailSheet", () => {
  it("renders a back/close control and full profile link when open", () => {
    const { hook } = memoryLocation({ path: "/today" });
    render(
      <Router hook={hook}>
        <ResponsiveDetailSheet open onOpenChange={() => {}} title="Jane Doe" fullPageHref="/profiles/1">
          details
        </ResponsiveDetailSheet>
      </Router>,
    );

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open full/i })).toHaveAttribute("href", "/profiles/1");
    expect(screen.getByText("details")).toBeInTheDocument();
  });
});
