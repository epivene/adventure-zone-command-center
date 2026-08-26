import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeadCommunicationBlocks } from "./lead-communication-blocks";

afterEach(cleanup);

describe("LeadCommunicationBlocks", () => {
  it("invalidates copy as soon as creation succeeds before a slow block-list refresh", async () => {
    let finishReload: ((value: any[]) => void) | undefined;
    const list = vi.fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise<any[]>((resolve) => { finishReload = resolve; }));
    const create = vi.fn().mockResolvedValue({});
    const onMutation = vi.fn();
    render(<LeadCommunicationBlocks list={list} create={create} remove={vi.fn()} onMutation={onMutation} />);
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Stable block target"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Block reason"), { target: { value: "requested no contact" } });
    fireEvent.click(screen.getByRole("button", { name: "Add DO NOT SEND block" }));

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(onMutation).toHaveBeenCalledOnce();
    finishReload?.([]);
  });

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

  it("loads and renders retained block history from the owner endpoint", async () => {
    const history = vi.fn().mockResolvedValue([{
      id: "event-1",
      blockId: "block-1",
      action: "created",
      actorId: "owner:amy",
      reason: "Requested no contact",
      createdAt: "2026-08-26T12:00:00.000Z",
    }]);
    render(<LeadCommunicationBlocks
      list={async () => [{
        id: "block-1",
        targetType: "recipient_email",
        normalizedEmail: "person@example.com",
        active: true,
        reason: "Requested no contact",
        createdAt: "2026-08-26T12:00:00.000Z",
      }]}
      create={vi.fn()}
      remove={vi.fn()}
      {...({ history } as any)}
    />);

    fireEvent.click(await screen.findByRole("button", { name: "View history for recipient_email: person@example.com" }));
    expect(await screen.findByText(/created by owner:amy/)).toBeInTheDocument();
    expect(screen.getByText(/Requested no contact/)).toBeInTheDocument();
    expect(history).toHaveBeenCalledWith("block-1");
  });
});
