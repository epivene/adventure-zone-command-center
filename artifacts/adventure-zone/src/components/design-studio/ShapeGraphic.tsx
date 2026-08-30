import type { ShapeNode } from "@/lib/design-studio/model";

/**
 * Renders a shape node as inline SVG. cornerRadius applies to rectangles;
 * flipX/flipY mirror via an SVG scale transform around the viewport centre.
 */
export function ShapeGraphic({ node }: { node: ShapeNode }) {
  const W = 100;
  const H = 100;
  const { stroke, strokeWidth, cornerRadius, flipX, flipY } = node;

  // Build a scale transform that mirrors the content around the centre of the
  // viewBox while keeping the bounding box in place.
  const scaleX = flipX ? -1 : 1;
  const scaleY = flipY ? -1 : 1;
  const transform =
    flipX || flipY
      ? `translate(${flipX ? W : 0},${flipY ? H : 0}) scale(${scaleX},${scaleY})`
      : undefined;

  const inner = (() => {
    switch (node.variant) {
      case "rectangle": {
        // Clamp radius to half the shorter side so it never exceeds the shape.
        const rx = Math.min(cornerRadius, W / 2, H / 2);
        return (
          <rect
            x="0"
            y="0"
            width={W}
            height={H}
            rx={rx}
            ry={rx}
            fill={node.fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      }
      case "circle":
        return (
          <ellipse
            cx={W / 2}
            cy={H / 2}
            rx={Math.max(0, W / 2 - strokeWidth / 2)}
            ry={Math.max(0, H / 2 - strokeWidth / 2)}
            fill={node.fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      case "triangle":
        return (
          <polygon
            points={`${W / 2},2 ${W - 2},${H - 2} 2,${H - 2}`}
            fill={node.fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      case "star": {
        const cx = W / 2;
        const cy = H / 2;
        const outer = W / 2 - 2;
        const inner = outer * 0.42;
        const pts: string[] = [];
        for (let i = 0; i < 10; i += 1) {
          const r = i % 2 === 0 ? outer : inner;
          const angle = (Math.PI / 5) * i - Math.PI / 2;
          pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
        }
        return (
          <polygon
            points={pts.join(" ")}
            fill={node.fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      }
      case "line":
        return (
          <line
            x1="2"
            y1={H / 2}
            x2={W - 2}
            y2={H / 2}
            stroke={stroke}
            strokeWidth={Math.max(2, strokeWidth)}
            strokeLinecap="round"
          />
        );
      case "arrow":
        return (
          <g>
            <line
              x1="2"
              y1={H / 2}
              x2={W - 16}
              y2={H / 2}
              stroke={stroke}
              strokeWidth={Math.max(2, strokeWidth)}
              strokeLinecap="round"
            />
            <polygon
              points={`${W - 2},${H / 2} ${W - 20},${H / 2 - 12} ${W - 20},${H / 2 + 12}`}
              fill={stroke}
            />
          </g>
        );
      default:
        return null;
    }
  })();

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-full w-full"
    >
      {transform ? <g transform={transform}>{inner}</g> : inner}
    </svg>
  );
}
