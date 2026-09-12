import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createBlankEmailDocument } from "@/features/email-template-builder/email-builder-types";
import { EmailBuilder } from "./EmailBuilder";

describe("EmailBuilder", () => {
  it("adds, edits, moves, duplicates, deletes, and undoes blocks with touch-safe controls", () => {
    const onChange = vi.fn();
    render(<EmailBuilder value={createBlankEmailDocument()} onChange={onChange} previewHtml="<p>Preview</p>" />);

    fireEvent.click(screen.getByRole("button", { name: "Add Hero banner" }));
    const canvas = screen.getByRole("region", { name: "Email canvas" });
    expect(within(canvas).getByText("Hero banner")).toBeInTheDocument();

    fireEvent.click(within(canvas).getByRole("button", { name: "Move Hero banner up" }));
    fireEvent.click(within(canvas).getByRole("button", { name: "Duplicate Hero banner" }));
    expect(within(canvas).getAllByText("Hero banner")).toHaveLength(2);

    fireEvent.click(within(canvas).getAllByRole("button", { name: "Edit Hero banner" })[0]!);
    const headline = screen.getByRole("textbox", { name: "Headline" });
    fireEvent.change(headline, { target: { value: "A BRANDED EMAIL" } });
    expect(onChange.mock.calls.at(-1)?.[0].blocks.some((block: { headline?: string }) => block.headline === "A BRANDED EMAIL")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("textbox", { name: "Headline" })).not.toHaveValue("A BRANDED EMAIL");

    fireEvent.click(within(canvas).getAllByRole("button", { name: "Delete Hero banner" })[0]!);
    expect(within(canvas).getAllByText("Hero banner")).toHaveLength(1);
  });

  it("inserts placeholders and switches between desktop and mobile previews", () => {
    const onChange = vi.fn();
    render(<EmailBuilder value={createBlankEmailDocument()} onChange={onChange} previewHtml="<p>Preview</p>" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Text" }));
    fireEvent.change(screen.getByLabelText("Insert placeholder"), { target: { value: "eventName" } });
    expect(onChange.mock.calls.at(-1)?.[0].blocks[0].content).toContain("{{eventName}}");

    fireEvent.click(screen.getByRole("button", { name: "Mobile preview" }));
    expect(screen.getByRole("button", { name: "Mobile preview" })).toHaveAttribute("aria-pressed", "true");
  });

  it("adds safe rich-text formatting and exposes anchored mobile editor controls", () => {
    const onChange = vi.fn();
    render(<EmailBuilder value={createBlankEmailDocument()} onChange={onChange} previewHtml="<p>Preview</p>" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Text" }));
    fireEvent.change(screen.getByLabelText("Text format"), { target: { value: "rich_text" } });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(onChange.mock.calls.at(-1)?.[0].blocks[0]).toMatchObject({ contentFormat: "rich_text", content: expect.stringContaining("<strong>Bold text</strong>") });
    expect(screen.getByRole("navigation", { name: "Mobile editor panels" })).toBeInTheDocument();
  });
});
