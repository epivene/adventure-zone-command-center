import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayersSheet } from "./LayersSheet";
import { createTextNode } from "@/lib/design-studio/model";
import type { FreeformEditor } from "./use-freeform-editor";

function editorFixture(): FreeformEditor {
  const node = createTextNode({ id: "node-1", name: "Headline" });
  return {
    page: { id: "page-1", name: "Page 1", background: "#fff", nodes: [node] },
    selectedIds: ["node-1"],
    select: vi.fn(),
    reorder: vi.fn(),
    patchNodes: vi.fn(),
  } as unknown as FreeformEditor;
}

describe("LayersSheet", () => {
  it("moves a selected layer to the front", async () => {
    const user = userEvent.setup();
    const editor = editorFixture();
    render(<LayersSheet editor={editor} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /bring headline to front/i }));
    expect(editor.reorder).toHaveBeenCalledWith("node-1", "front");
  });
});
