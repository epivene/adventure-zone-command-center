// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  angleDelta,
  angleFromCenter,
  applyRotation,
  boundingBox,
  computeSnap,
  marqueeRect,
  normalizeAngle,
  rectsIntersect,
  resizeRect,
  snapAngle,
  snapToGrid,
  type Rect,
} from "./geometry";

describe("boundingBox", () => {
  it("returns null for no rects", () => {
    expect(boundingBox([])).toBeNull();
  });
  it("encloses all rects", () => {
    const box = boundingBox([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 30, width: 10, height: 10 },
    ]);
    expect(box).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });
});

describe("rectsIntersect / marqueeRect", () => {
  it("detects overlap", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: 20, y: 20, width: 5, height: 5 })).toBe(false);
  });
  it("normalizes a marquee dragged up-left", () => {
    expect(marqueeRect({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 30,
    });
  });
});

describe("resizeRect", () => {
  const rect: Rect = { x: 100, y: 100, width: 200, height: 100 };

  it("resizes from the SE handle", () => {
    const r = resizeRect(rect, "se", 40, 20);
    expect(r).toEqual({ x: 100, y: 100, width: 240, height: 120 });
  });

  it("moves the origin when resizing from the NW handle", () => {
    const r = resizeRect(rect, "nw", 20, 10);
    expect(r).toEqual({ x: 120, y: 110, width: 180, height: 90 });
  });

  it("enforces a minimum size", () => {
    const r = resizeRect(rect, "e", -500, 0);
    expect(r.width).toBeGreaterThanOrEqual(8);
  });

  it("keeps aspect ratio when requested", () => {
    const r = resizeRect(rect, "se", 100, 0, { keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(rect.width / rect.height, 5);
  });

  it("resizes symmetrically about center with fromCenter", () => {
    const r = resizeRect(rect, "e", 20, 0, { fromCenter: true });
    // center stays fixed
    expect(r.x + r.width / 2).toBeCloseTo(rect.x + rect.width / 2, 5);
    expect(r.width).toBe(240);
  });
});

describe("rotation helpers", () => {
  it("computes angle from center (0deg points up)", () => {
    expect(
      Math.round(angleFromCenter({ x: 0, y: 0 }, { x: 0, y: -10 })),
    ).toBe(0);
    expect(
      Math.round(angleFromCenter({ x: 0, y: 0 }, { x: 10, y: 0 })),
    ).toBe(90);
  });
  it("normalizes angles into 0-360", () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
  });
  it("snaps near a multiple of the step", () => {
    expect(snapAngle(43)).toBe(45);
    expect(snapAngle(52)).toBe(52); // outside tolerance (7deg from 45)
  });
});

describe("angleDelta", () => {
  it("returns the signed shortest difference", () => {
    expect(angleDelta(0, 30)).toBe(30);
    expect(angleDelta(30, 0)).toBe(-30);
  });
  it("wraps across the 0/360 boundary via the short arc", () => {
    expect(angleDelta(350, 10)).toBe(20); // +20, not -340
    expect(angleDelta(10, 350)).toBe(-20); // -20, not +340
  });
  it("caps magnitude at 180", () => {
    expect(Math.abs(angleDelta(0, 179))).toBeLessThanOrEqual(180);
    expect(Math.abs(angleDelta(0, 181))).toBeLessThanOrEqual(180);
  });
});

describe("applyRotation", () => {
  it("adds the pointer angular delta to the starting rotation", () => {
    // Node started at 30deg; pointer moved from 0deg to 40deg (+40).
    expect(applyRotation(30, 0, 40)).toBe(70);
  });

  it("preserves existing rotation when the pointer does not move", () => {
    expect(applyRotation(123, 45, 45)).toBe(123);
  });

  it("does not snap to face the pointer (delta-based, not absolute)", () => {
    // A naive absolute implementation would return ~90; delta-based returns 20.
    // start rotation 20, pointer unchanged => stays 20 (no snap in tolerance).
    expect(applyRotation(20, 90, 90)).toBe(20);
  });

  it("wraps into 0-360 when the delta crosses zero", () => {
    // start 350, pointer +30 => 380 -> 20
    expect(applyRotation(350, 0, 30)).toBe(20);
    // start 10, pointer -30 => -20 -> 340
    expect(applyRotation(10, 30, 0)).toBe(340);
  });

  it("optionally snaps the final absolute rotation", () => {
    // start 0, pointer +43 => 43, snaps to 45 within default tolerance
    expect(applyRotation(0, 0, 43, { snap: true })).toBe(45);
    // outside tolerance stays put
    expect(applyRotation(0, 0, 52, { snap: true })).toBe(52);
  });
});

describe("computeSnap", () => {
  const canvas = { width: 960, height: 720 };

  it("snaps a left edge to a nearby target left edge", () => {
    const moving = { x: 103, y: 200, width: 50, height: 50 };
    const target = { x: 100, y: 400, width: 50, height: 50 };
    const result = computeSnap(moving, [target], canvas);
    expect(result.dx).toBe(-3);
    expect(result.guides.some((g) => g.orientation === "vertical")).toBe(true);
  });

  it("returns zero delta when nothing is within threshold", () => {
    const moving = { x: 500, y: 500, width: 50, height: 50 };
    const target = { x: 0, y: 0, width: 20, height: 20 };
    const result = computeSnap(moving, [target], canvas);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(0);
  });

  it("snaps to canvas center", () => {
    const moving = { x: 452, y: 300, width: 60, height: 60 };
    const result = computeSnap(moving, [], canvas);
    // center of moving (482+... ) should snap toward canvas center 480
    expect(Math.abs(result.dx)).toBeLessThanOrEqual(6);
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest grid line", () => {
    expect(snapToGrid(23, 16)).toBe(16);
    expect(snapToGrid(25, 16)).toBe(32);
    expect(snapToGrid(25, 0)).toBe(25); // disabled
  });
});