import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResponsiveDetailSheet } from "./responsive-detail-sheet";

describe("ResponsiveDetailSheet", () => {
  it("renders a back/close control and full profile link when open", () => {
    render(
      <ResponsiveDetailSheet open onOpenChange={() => {}} title="Jane Doe" fullPageHref="/profiles/1">
        details
      </ResponsiveDetailSheet>,
    );

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open full/i })).toHaveAttribute("href", "/profiles/1");
    expect(screen.getByText("details")).toBeInTheDocument();
  });

  it("navigates on pointer down before parent click interceptors can reopen the sheet", () => {
    window.history.replaceState({}, "", "/today");
    const onOpenChange = vi.fn();
    render(
      <ResponsiveDetailSheet open onOpenChange={onOpenChange} title="Jane Doe" fullPageHref="/profiles/1">
        details
      </ResponsiveDetailSheet>,
    );

    fireEvent.pointerDown(screen.getByRole("link", { name: /open full/i }), { button: 0 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(window.location.pathname).toBe("/profiles/1");
  });
});
