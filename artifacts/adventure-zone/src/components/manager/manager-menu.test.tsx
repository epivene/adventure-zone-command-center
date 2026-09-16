// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ManagerMenu } from "./manager-menu";

describe("ManagerMenu", () => {
  it("gives leg managers a direct year-end inspection destination", async () => {
    render(<ManagerMenu onSignOut={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Menu" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("button", { name: /Events/ }));

    expect(screen.getByRole("menuitem", { name: "Year-End Inspection" })).toHaveAttribute(
      "href",
      "/manager/year-end-inspection",
    );
  });
});
