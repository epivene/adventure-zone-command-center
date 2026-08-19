import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PackageTemplateEditor } from "./package-template-editor";

describe("PackageTemplateEditor base price", () => {
  it("shows an editable dollar price and allows unknown packages to stay blank", () => {
    render(
      <PackageTemplateEditor
        templates={[
          {
            id: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
            code: "adventure_zone",
            name: "Adventure Zone",
            basePriceCents: 800000,
            baseAttractionCount: 10,
            minimumAttractionCount: 10,
            maximumAttractionCount: 12,
            active: true,
          },
          {
            id: "5fbc77e5-5453-42af-9316-b0ea6ca91ae5",
            code: "weekend_warriors",
            name: "Warrior's Playground",
            basePriceCents: null,
            baseAttractionCount: 5,
            minimumAttractionCount: 5,
            maximumAttractionCount: 5,
            active: true,
          },
        ]}
        onSubmit={() => ({ ok: true })}
      />,
    );

    expect(screen.getByLabelText("Adventure Zone base price")).toHaveValue(8000);
    expect(screen.getByLabelText("Warrior's Playground base price")).toHaveValue(null);
    expect(screen.getAllByText(/editable starting price/i)).toHaveLength(2);
  });
});
