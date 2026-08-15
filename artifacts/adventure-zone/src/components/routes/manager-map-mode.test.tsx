// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ManagerMapModeToggle } from "./manager-map-mode";

describe("ManagerMapModeToggle", () => {
  it("shows the selected mode and changes explicitly", () => {
    const onChange = vi.fn();
    render(<ManagerMapModeToggle mode="planning" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Planning" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "On the Road" }));
    expect(onChange).toHaveBeenCalledWith("on-road");
  });
});
