export type PhotoEllipse = {
  id: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
};

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; width: number; height: number };

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const precise = (value: number) => Number(value.toFixed(6));

export function pointerEllipse(start: Point, end: Point, bounds: Bounds, id: string = crypto.randomUUID()): PhotoEllipse {
  return pointerPathEllipse([start, end], bounds, id);
}

export function pointerPathEllipse(points: Point[], bounds: Bounds, id: string = crypto.randomUUID()): PhotoEllipse {
  const normalized = points.map((point) => ({
    x: clamp((point.x - bounds.left) / bounds.width),
    y: clamp((point.y - bounds.top) / bounds.height),
  }));
  const left = Math.min(...normalized.map((point) => point.x));
  const right = Math.max(...normalized.map((point) => point.x));
  const top = Math.min(...normalized.map((point) => point.y));
  const bottom = Math.max(...normalized.map((point) => point.y));
  return {
    id,
    x: precise((left + right) / 2),
    y: precise((top + bottom) / 2),
    radiusX: precise((right - left) / 2),
    radiusY: precise((bottom - top) / 2),
  };
}

export function ellipseStyle(ellipse: PhotoEllipse) {
  return {
    left: `${(ellipse.x - ellipse.radiusX) * 100}%`,
    top: `${(ellipse.y - ellipse.radiusY) * 100}%`,
    width: `${ellipse.radiusX * 200}%`,
    height: `${ellipse.radiusY * 200}%`,
  };
}

