import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextualBottomToolbar } from "./ContextualBottomToolbar";
import type { FreeformEditor } from "./use-freeform-editor";
import { createImageNode, createTextNode } from "@/lib/design-studio/model";

function editorFixture(selectedNodes: FreeformEditor["selectedNodes"]): FreeformEditor {
  return {
    selectedNodes,
    selectedIds: selectedNodes.map((node) => node.id),
    canEdit: true,
    patchSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    removeSelected: vi.fn(),
    reorder: vi.fn(),
    insertNode: vi.fn(),
    setZoom: vi.fn(),
    doc: { zoom: 1 },
  } as unknown as FreeformEditor;
}

describe("ContextualBottomToolbar", () => {
  it("shows text controls for a selected text node", () => {
    render(<ContextualBottomToolbar editor={editorFixture([createTextNode({ id: "text-1" })])} />);

    expect(screen.getByLabelText(/text content/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/text size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/text color/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /duplicate/i })).toBeInTheDocument();
  });

  it("shows replace photo for a selected image", () => {
    render(<ContextualBottomToolbar editor={editorFixture([createImageNode({ id: "image-1" })])} onReplacePhoto={vi.fn()} />);
    expect(screen.getByRole("button", { name: /replace photo/i })).toBeInTheDocument();
  });

  it("shows add controls when nothing is selected", () => {
    render(<ContextualBottomToolbar editor={editorFixture([])} />);
    expect(screen.getByRole("button", { name: /add text/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add shape/i })).toBeInTheDocument();
  });
});
