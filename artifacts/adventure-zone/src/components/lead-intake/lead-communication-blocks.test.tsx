import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeadCommunicationBlocks } from "./lead-communication-blocks";

afterEach(cleanup);

describe("LeadCommunicationBlocks", () => {
  it("creates a clearly labelled global internal-preview block without a target", async () => {
    const create = vi.fn().mockResolvedValue({});
    render(<LeadCommunicationBlocks list={async () => []} create={create} remove={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "internal_preview" } });
    expect(screen.queryByLabelText("Stable block target")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Block reason"), { target: { value: "Pause every internal preview" } });
    fireEvent.click(screen.getByRole("button", { name: "Add DO NOT SEND block" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      targetType: "internal_preview",
      reason: "Pause every internal preview",
    }));
    expect(screen.getByRole("option", { name: "Global internal preview (no target)" })).toBeInTheDocument();
  });

  it("requires and submits a user-entered removal reason for global scope", async () => {
    const remove = vi.fn().mockResolvedValue({});
    render(<LeadCommunicationBlocks
      list={async () => [{
        id: "block-1",
        targetType: "internal_preview",
        active: true,
        reason: "Pause previews",
        createdAt: "2026-08-26T00:00:00.000Z",
      }]}
      create={vi.fn()}
      remove={remove}
    />);

    expect(await screen.findByText(/Global internal preview/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Remove" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Removal reason for Global internal preview"), {
      target: { value: "Owner cleared the global pause" },
    });
    fireEvent.click(button);

    await waitFor(() => expect(remove).toHaveBeenCalledWith("block-1", "Owner cleared the global pause"));
  });
});
