import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PaperNoteReviewSection } from "./paper-note-entry-card";

describe("PaperNoteReviewSection", () => {
  it("supports calm collapsible sections with useful summaries", () => {
    render(
      <>
        <PaperNoteReviewSection title="Event details" summary="Kalispell, MT" defaultOpen>
          <div>Event fields</div>
        </PaperNoteReviewSection>
        <PaperNoteReviewSection title="Historical activity" summary="Call · Jul 4, 2025">
          <div>Historical fields</div>
        </PaperNoteReviewSection>
      </>,
    );

    const event = screen.getByTestId("paper-note-section-event-details") as HTMLDetailsElement;
    const history = screen.getByTestId("paper-note-section-historical-activity") as HTMLDetailsElement;

    expect(event.open).toBe(true);
    expect(history.open).toBe(false);
    expect(screen.getByText("Kalispell, MT")).toBeInTheDocument();
    expect(screen.getByText("Call · Jul 4, 2025")).toBeInTheDocument();
  });
});
