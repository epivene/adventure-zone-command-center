import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaperNoteEntryErrorBoundary } from "./paper-note-entry-error-boundary";

function BrokenEntry() {
  throw new Error("boom");
}

describe("PaperNoteEntryErrorBoundary", () => {
  it("shows a recovery card instead of leaving a blank screen", () => {
    render(
      <PaperNoteEntryErrorBoundary entryId="entry-1">
        <BrokenEntry />
      </PaperNoteEntryErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/paper entry hit an error/i);
    expect(screen.getByRole("button", { name: /reload this entry/i })).toBeInTheDocument();
  });
});
