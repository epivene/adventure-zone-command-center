import { describe, expect, it } from "vitest";

import { pointerEllipse } from "./inspection-photo-annotations";

describe("pointerEllipse", () => {
  it("normalizes a dragged circle against the displayed photo bounds", () => {
    expect(pointerEllipse(
      { x: 110, y: 70 },
      { x: 210, y: 130 },
      { left: 10, top: 10, width: 400, height: 200 },
      "circle-1",
    )).toEqual({
      id: "circle-1",
      x: 0.375,
      y: 0.45,
      radiusX: 0.125,
      radiusY: 0.15,
    });
  });
});
