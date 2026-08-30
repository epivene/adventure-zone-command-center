// Pure geometry helpers for selection, resize, rotation, and snapping.
// Everything here is framework-agnostic and deterministic so it can be unit
// tested in isolation from React.

import type { CanvasNode } from "./model";

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export const RESIZE_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

const MIN_SIZE = 8;

export function rectOf(node: CanvasNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Axis-aligned bounding box that encloses every rect. */
export function boundingBox(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Marquee selection: rect that starts at `from` and ends at `to`. */
export function marqueeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * Apply a resize gesture to a rect. `dx`/`dy` is the pointer delta in canvas
 * pixels. `keepAspect` (Shift) preserves the original aspect ratio; `fromCenter`
 * (Alt) resizes symmetrically about the rect center. Never shrinks below
 * MIN_SIZE.
 */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  opts: { keepAspect?: boolean; fromCenter?: boolean } = {},
): Rect {
  let { x, y, width, height } = rect;
  const affectsE = handle.includes("e");
  const affectsW = handle.includes("w");
  const affectsN = handle.includes("n");
  const affectsS = handle.includes("s");

  const centerFactor = opts.fromCenter ? 2 : 1;

  if (affectsE) width += dx * centerFactor;
  if (affectsW) {
    width -= dx * centerFactor;
    if (!opts.fromCenter) x += dx;
  }
  if (affectsS) height += dy * centerFactor;
  if (affectsN) {
    height -= dy * centerFactor;
    if (!opts.fromCenter) y += dy;
  }

  if (opts.keepAspect && rect.width > 0 && rect.height > 0) {
    const ratio = rect.width / rect.height;
    // Drive the smaller of the two edges from the larger one.
    if (Math.abs(width - rect.width) >= Math.abs(height - rect.height)) {
      const newHeight = width / ratio;
      if (affectsN && !opts.fromCenter) y += height - newHeight;
      height = newHeight;
    } else {
      const newWidth = height * ratio;
      if (affectsW && !opts.fromCenter) x += width - newWidth;
      width = newWidth;
    }
  }

  if (opts.fromCenter) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    x = cx - width / 2;
    y = cy - height / 2;
  }

  width = Math.max(MIN_SIZE, width);
  height = Math.max(MIN_SIZE, height);
  return { x, y, width, height };
}

/** Angle in degrees from a center point to a pointer position. */
export function angleFromCenter(center: Point, pointer: Point): number {
  const rad = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  return (rad * 180) / Math.PI + 90; // 0deg == pointing up
}

export function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

/** Snap an angle to the nearest `step` when within `tolerance` degrees. */
export function snapAngle(angle: number, step = 15, tolerance = 6): number {
  const nearest = Math.round(angle / step) * step;
  return Math.abs(angle - nearest) <= tolerance ? nearest : angle;
}

/**
 * Signed shortest angular difference `to - from`, in degrees, in the range
 * (-180, 180]. Used to convert two absolute pointer angles into an incremental
 * rotation delta.
 */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Apply a rotation gesture to a node's starting rotation.
 *
 * `startRotation` is the node's rotation when the gesture began, `startPointer`
 * is the pointer angle at grab time, and `currentPointer` is the live pointer
 * angle. The pointer delta is added to the existing rotation so the node
 * rotates relative to where it was grabbed (never snapping to face the pointer).
 * Optional snapping is applied to the final absolute rotation.
 */
export function applyRotation(
  startRotation: number,
  startPointer: number,
  currentPointer: number,
  opts: { snap?: boolean; snapStep?: number; snapTolerance?: number } = {},
): number {
  const delta = angleDelta(startPointer, currentPointer);
  let next = startRotation + delta;
  if (opts.snap) {
    next = snapAngle(next, opts.snapStep ?? 15, opts.snapTolerance ?? 6);
  }
  return normalizeAngle(next);
}

// --- Alignment / snapping guides -----------------------------------------

export type Guide = { orientation: "vertical" | "horizontal"; position: number };

export type SnapResult = { dx: number; dy: number; guides: Guide[] };

function candidateLines(rect: Rect, axis: "x" | "y"): number[] {
  return axis === "x"
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

/**
 * Compute a snap adjustment for a moving rect against a set of static rects and
 * the canvas bounds. Returns the delta to add to the proposed position plus the
 * guide lines to draw. `threshold` is in canvas pixels.
 */
export function computeSnap(
  moving: Rect,
  targets: Rect[],
  canvas: { width: number; height: number },
  threshold = 6,
): SnapResult {
  const guides: Guide[] = [];
  let bestDx: { delta: number; dist: number; pos: number } | null = null;
  let bestDy: { delta: number; dist: number; pos: number } | null = null;

  const canvasRect: Rect = {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
  };
  const staticTargets = [...targets, canvasRect];

  for (const target of staticTargets) {
    for (const mv of candidateLines(moving, "x")) {
      for (const tv of candidateLines(target, "x")) {
        const dist = Math.abs(tv - mv);
        if (dist <= threshold && (!bestDx || dist < bestDx.dist)) {
          bestDx = { delta: tv - mv, dist, pos: tv };
        }
      }
    }
    for (const mh of candidateLines(moving, "y")) {
      for (const th of candidateLines(target, "y")) {
        const dist = Math.abs(th - mh);
        if (dist <= threshold && (!bestDy || dist < bestDy.dist)) {
          bestDy = { delta: th - mh, dist, pos: th };
        }
      }
    }
  }

  if (bestDx) guides.push({ orientation: "vertical", position: bestDx.pos });
  if (bestDy) guides.push({ orientation: "horizontal", position: bestDy.pos });

  return {
    dx: bestDx ? bestDx.delta : 0,
    dy: bestDy ? bestDy.delta : 0,
    guides,
  };
}

/** Snap a single coordinate to a grid. */
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}
