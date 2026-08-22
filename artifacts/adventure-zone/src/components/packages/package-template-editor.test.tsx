import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PackageTemplateEditor } from "./package-template-editor";

describe("PackageTemplateEditor reviewed knowledge", () => {
  it("shows editable duration fields and the owner review note", () => {
    render(
      <PackageTemplateEditor
        templates={[
          {
            id: "00000000-0000-4000-8000-000000000001",
            code: "mini_zone",
            name: "Mini Zone",
            basePriceCents: 500000,
            baseAttractionCount: 5,
            minimumAttractionCount: 5,
            maximumAttractionCount: 5,
            baseDurationMinDays: 1,
            baseDurationMaxDays: 4,
            customerDescription: "Smaller setup",
            bookingTalkingPoints: "For tighter events",
            operationalRequirements: "Confirm power",
            setupNotes: "Normal setup",
            knowledgeReviewNote:
              "Water-barrel source conflict: 44 vs 50; confirm before quoting.",
            active: true,
          },
        ]}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    expect(screen.getByLabelText("Mini Zone minimum duration days")).toHaveValue(1);
    expect(screen.getByLabelText("Mini Zone maximum duration days")).toHaveValue(4);
    expect(screen.getByText(/44 vs 50/i)).toBeInTheDocument();
  });
});
