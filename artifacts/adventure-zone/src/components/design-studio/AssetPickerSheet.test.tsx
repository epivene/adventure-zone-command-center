import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetPickerSheet } from "./AssetPickerSheet";


describe("AssetPickerSheet", () => {
  it("returns the selected Adventure Zone image", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();

    render(<AssetPickerSheet assets={[]} onChoose={onChoose} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /sabretooth/i }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringMatching(/sabretooth/i) }));
  });
});
