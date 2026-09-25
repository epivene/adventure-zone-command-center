import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspacePanel } from "./WorkspacePanel";
import { mockNativeDialog } from "@/test/native-dialog";

let wide = false;
let change: (() => void) | undefined;
let restoreDialog: () => void;
beforeEach(() => {
  wide = false;
  change = undefined;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return wide;
      },
      addEventListener: (_: string, listener: () => void) => {
        change = listener;
      },
      removeEventListener: vi.fn(),
    })),
  );
  restoreDialog = mockNativeDialog();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreDialog();
});

function DraftEditor() {
  const [text, setText] = useState("Original draft");
  return (
    <textarea
      aria-label="Draft wording"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open drafts
      </button>
      <WorkspacePanel
        title="Drafts and actions"
        open={open}
        onOpenChange={setOpen}
        minWidth={1280}
      >
        <DraftEditor />
      </WorkspacePanel>
    </>
  );
}

it("provides a named modal sheet and preserves edits across closing and reopening", () => {
  render(<Harness />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open drafts" }));
  const sheet = screen.getByRole("dialog", { name: "Drafts and actions" });
  expect(sheet).toHaveAttribute("aria-modal", "true");
  const editor = screen.getByRole("textbox", { name: "Draft wording" });
  fireEvent.change(editor, { target: { value: "My unfinished edit" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Close drafts and actions" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open drafts" }));
  expect(screen.getByRole("textbox", { name: "Draft wording" })).toBe(editor);
  expect(editor).toHaveValue("My unfinished edit");
  fireEvent(sheet, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps one editor while switching between a compact sheet and desktop rail", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Open drafts" }));
  const editor = screen.getByRole("textbox", { name: "Draft wording" });
  fireEvent.change(editor, { target: { value: "Keep this while unfolding" } });
  act(() => {
    wide = true;
    change?.();
  });
  const rail = screen.getByRole("complementary", {
    name: "Drafts and actions",
  });
  expect(rail).not.toHaveAttribute("aria-modal");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.getByRole("textbox")).toBe(editor);
  act(() => {
    wide = false;
    change?.();
  });
  expect(
    screen.getByRole("dialog", { name: "Drafts and actions" }),
  ).toHaveAttribute("open");
  expect(screen.getByRole("textbox")).toBe(editor);
  expect(editor).toHaveValue("Keep this while unfolding");
});
