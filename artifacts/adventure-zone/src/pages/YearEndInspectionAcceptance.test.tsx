import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InspectionRecordView, type InspectionRecordDto } from "@/components/year-end-inspections/inspection-record-view";

describe("year-end inspection evidence acceptance", () => {
  it("renders the original finding, annotation, and description together", () => {
    const inspection: InspectionRecordDto = {
      id: "inspection-1", legId: "leg-1", inspectionYear: 2026, status: "completed", copiedFromInspectionId: null,
      updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      progress: { total: 1, notStarted: 0, inspected: 1, notPresent: 0, needsAttention: 1, percentComplete: 100 },
      entries: [{
        id: "entry-1", pieceId: "piece-1", pieceCodeSnapshot: "AZ-017", pieceNameSnapshot: "Anchor panel", resourceNameSnapshot: "Warrior Wall",
        entryState: "inspected", condition: "major_repair", inspectionNotes: "Anchor panel tear", repairNeeded: true, repairNotes: "Patch before reuse", retainForFutureUse: true,
        maintenanceItem: { id: "repair-1", state: "open", resolutionNotes: null },
        photos: [{ id: "photo-1", signedUrl: "https://example.test/private-signed-photo", description: "Circle shows the worn anchor panel", annotations: { version: 1, ellipses: [{ id: "circle-1", x: .5, y: .5, radiusX: .1, radiusY: .1 }] } }],
      }],
    };
    render(<InspectionRecordView inspection={inspection} />);
    const image = screen.getByAltText("Circle shows the worn anchor panel");
    const description = screen.getByText("Circle shows the worn anchor panel");
    expect(screen.getByText("Anchor panel tear")).toBeVisible();
    expect(screen.getByLabelText("Marked photo area")).toBeVisible();
    expect(image.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
