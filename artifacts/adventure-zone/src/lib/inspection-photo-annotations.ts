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

export function pointerEllipse(start: Point, end: Point, bounds: Bounds, id = crypto.randomUUID()): PhotoEllipse {
  const startX = clamp((start.x - bounds.left) / bounds.width);
  const startY = clamp((start.y - bounds.top) / bounds.height);
  const endX = clamp((end.x - bounds.left) / bounds.width);
  const endY = clamp((end.y - bounds.top) / bounds.height);
  return {
    id,
    x: precise((startX + endX) / 2),
    y: precise((startY + endY) / 2),
    radiusX: precise(Math.abs(endX - startX) / 2),
    radiusY: precise(Math.abs(endY - startY) / 2),
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
