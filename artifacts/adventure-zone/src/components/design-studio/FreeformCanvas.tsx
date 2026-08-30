import { useCallback, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "@workspace/avz-crm/lib/utils";
import { updateNodes } from "@/lib/design-studio/commands";
import {
  angleFromCenter,
  applyRotation,
  boundingBox,
  computeSnap,
  marqueeRect,
  rectOf,
  rectsIntersect,
  resizeRect,
  RESIZE_HANDLES,
  type Guide,
  type Point,
  type Rect,
  type ResizeHandle,
} from "@/lib/design-studio/geometry";
import { getActivePage, type CanvasNode } from "@/lib/design-studio/model";
import { resolveImageSrc, type DesignAsset } from "@/lib/design-studio-api";
import type { FreeformEditor } from "./use-freeform-editor";
import { ShapeGraphic } from "./ShapeGraphic";

type GestureKind = "move" | "resize" | "rotate" | "marquee";

type Gesture = {
  kind: GestureKind;
  handle?: ResizeHandle;
  origin: Point; // canvas-space pointer at start
  startRects: Map<string, Rect>;
  startAngles: Map<string, number>;
  /** Pointer angle (deg) at grab time, for delta-based rotation. */
  startPointerAngle: number;
  center: Point;
  marquee?: Rect;
  ids: string[];
};

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

export function FreeformCanvas({
  editor,
  assets = [],
}: {
  editor: FreeformEditor;
  assets?: DesignAsset[];
}) {
  const { doc, page, canEdit, selectedIds } = editor;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const scale = doc.zoom ?? 1;

  const selectionBox = useMemo(() => {
    const rects = page.nodes
      .filter((n) => selectedIds.includes(n.id) && !n.hidden)
      .map(rectOf);
    return boundingBox(rects);
  }, [page.nodes, selectedIds]);

  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const el = surfaceRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [scale],
  );

  // --- Gesture lifecycle --------------------------------------------------

  const startGesture = useCallback(
    (
      kind: GestureKind,
      event: React.PointerEvent,
      ids: string[],
      handle?: ResizeHandle,
    ) => {
      if (!canEdit) return;
      const origin = toCanvasPoint(event.clientX, event.clientY);
      const activePage = getActivePage(doc);
      const startRects = new Map<string, Rect>();
      const startAngles = new Map<string, number>();
      for (const node of activePage.nodes) {
        if (ids.includes(node.id)) {
          startRects.set(node.id, rectOf(node));
          startAngles.set(node.id, node.rotation);
        }
      }
      const box = boundingBox([...startRects.values()]);
      const center = box
        ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        : origin;
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setGesture({
        kind,
        handle,
        origin,
        startRects,
        startAngles,
        startPointerAngle: angleFromCenter(center, origin),
        center,
        ids,
      });
    },
    [canEdit, doc, toCanvasPoint],
  );

  const onNodePointerDown = useCallback(
    (event: React.PointerEvent, node: CanvasNode) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      if (node.locked || node.hidden || !canEdit) {
        editor.select(node.id, event.shiftKey);
        return;
      }
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      let ids = selectedIds;
      if (!selectedIds.includes(node.id)) {
        editor.select(node.id, additive);
        ids = additive ? [...selectedIds, node.id] : [node.id];
      }
      // Expand to group peers for the drag set.
      const groupSet = new Set(ids);
      for (const peer of page.nodes) {
        if (peer.groupId && ids.some((id) => page.nodes.find((n) => n.id === id)?.groupId === peer.groupId)) {
          groupSet.add(peer.id);
        }
      }
      // Locked nodes never participate in a move gesture, so the drag set (and
      // therefore the snap bounding box) only covers nodes that will move.
      const movable = [...groupSet].filter(
        (id) => !page.nodes.find((n) => n.id === id)?.locked,
      );
      if (movable.length === 0) return;
      startGesture("move", event, movable);
    },
    [canEdit, editor, page.nodes, selectedIds, startGesture],
  );

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent, handle: ResizeHandle) => {
      event.stopPropagation();
      if (selectedIds.length !== 1) return;
      startGesture("resize", event, selectedIds, handle);
    },
    [selectedIds, startGesture],
  );

  const onRotatePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.stopPropagation();
      if (selectedIds.length !== 1) return;
      startGesture("rotate", event, selectedIds);
    },
    [selectedIds, startGesture],
  );

  const onSurfacePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      editor.select(null);
      if (!canEdit) return;
      const origin = toCanvasPoint(event.clientX, event.clientY);
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      setGesture({
        kind: "marquee",
        origin,
        startRects: new Map(),
        startAngles: new Map(),
        startPointerAngle: 0,
        center: origin,
        ids: [],
      });
    },
    [canEdit, editor, toCanvasPoint],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!gesture) return;
      const point = toCanvasPoint(event.clientX, event.clientY);
      const dx = point.x - gesture.origin.x;
      const dy = point.y - gesture.origin.y;

      if (gesture.kind === "marquee") {
        const rect = marqueeRect(gesture.origin, point);
        setMarquee(rect);
        return;
      }

      if (gesture.kind === "move") {
        const others = page.nodes
          .filter((n) => !gesture.ids.includes(n.id) && !n.hidden)
          .map(rectOf);
        // Compute snap on the moving bounding box.
        const startBox = boundingBox([...gesture.startRects.values()])!;
        const proposed: Rect = { ...startBox, x: startBox.x + dx, y: startBox.y + dy };
        const snap = event.altKey
          ? { dx: 0, dy: 0, guides: [] as Guide[] }
          : computeSnap(proposed, others, doc);
        const totalDx = dx + snap.dx;
        const totalDy = dy + snap.dy;
        setGuides(snap.guides);
        const next = doc.pages.map((p) =>
          p.id !== doc.activePageId
            ? p
            : {
                ...p,
                nodes: p.nodes.map((n) => {
                  const start = gesture.startRects.get(n.id);
                  // Never move locked nodes, even when dragged as part of a group.
                  if (!start || n.locked) return n;
                  return { ...n, x: start.x + totalDx, y: start.y + totalDy };
                }),
              },
        );
        editor.setDoc({ ...doc, pages: next });
        return;
      }

      if (gesture.kind === "resize" && gesture.handle) {
        const id = gesture.ids[0]!;
        const start = gesture.startRects.get(id)!;
        const resized = resizeRect(start, gesture.handle, dx, dy, {
          keepAspect: event.shiftKey,
          fromCenter: event.altKey,
        });
        editor.setDoc(
          updateNodes(doc, [id], {
            x: resized.x,
            y: resized.y,
            width: resized.width,
            height: resized.height,
          }),
        );
        return;
      }

      if (gesture.kind === "rotate") {
        const id = gesture.ids[0]!;
        const startRotation = gesture.startAngles.get(id) ?? 0;
        const currentPointerAngle = angleFromCenter(gesture.center, point);
        // Apply the pointer's angular delta to the node's starting rotation so
        // rotation is relative to the grab point and preserves prior rotation.
        const rotation = applyRotation(
          startRotation,
          gesture.startPointerAngle,
          currentPointerAngle,
          event.shiftKey
            ? { snap: true, snapStep: 15, snapTolerance: 90 }
            : { snap: true },
        );
        editor.setDoc(updateNodes(doc, [id], { rotation }));
        return;
      }
    },
    [doc, editor, gesture, page.nodes, toCanvasPoint],
  );

  const endGesture = useCallback(() => {
    if (!gesture) return;
    if (gesture.kind === "marquee") {
      if (marquee && (marquee.width > 3 || marquee.height > 3)) {
        const hits = page.nodes
          .filter((n) => !n.hidden && !n.locked && rectsIntersect(rectOf(n), marquee))
          .map((n) => n.id);
        editor.setSelection(hits);
      }
      setMarquee(null);
      setGesture(null);
      return;
    }
    setGuides([]);
    setGesture(null);
    editor.commitGesture();
  }, [editor, gesture, marquee, page.nodes]);

  // --- Rendering ----------------------------------------------------------

  const cursor =
    gesture?.kind === "resize" && gesture.handle
      ? HANDLE_CURSORS[gesture.handle]
      : gesture?.kind === "move"
        ? "grabbing"
        : "default";

  return (
    <div className="flex flex-1 items-start justify-center overflow-auto bg-muted/40 p-6" data-testid="freeform-scroll">
      <div
        style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
      >
        <div
          ref={surfaceRef}
          className="relative select-none overflow-hidden rounded-xl border-2 border-border shadow-2xl"
          style={{
            width: doc.width,
            height: doc.height,
            backgroundColor: page.background,
            cursor,
            touchAction: "none",
          }}
          data-testid="freeform-surface"
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          {/* Optional grid */}
          {doc.showGrid ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
                backgroundSize: `${doc.gridSize}px ${doc.gridSize}px`,
              }}
            />
          ) : null}

          {/* Nodes */}
          {page.nodes.map((node) =>
            node.hidden ? null : (
              <NodeView
                key={node.id}
                node={node}
                selected={selectedIds.includes(node.id)}
                assets={assets}
                onPointerDown={onNodePointerDown}
                onSelect={editor.select}
              />
            ),
          )}

          {/* Alignment guides */}
          {guides.map((guide, i) => (
            <div
              key={`${guide.orientation}-${i}`}
              aria-hidden
              className="pointer-events-none absolute bg-accent"
              style={
                guide.orientation === "vertical"
                  ? { left: guide.position, top: 0, width: 1, height: "100%" }
                  : { top: guide.position, left: 0, height: 1, width: "100%" }
              }
            />
          ))}

          {/* Selection frame + handles (single or multi) */}
          {selectionBox && !marquee ? (
            <SelectionFrame
              box={selectionBox}
              single={selectedIds.length === 1}
              locked={editor.selectedNodes.every((n) => n.locked)}
              scale={scale}
              onHandlePointerDown={onHandlePointerDown}
              onRotatePointerDown={onRotatePointerDown}
            />
          ) : null}

          {/* Marquee rectangle */}
          {marquee ? (
            <div
              aria-hidden
              className="pointer-events-none absolute border border-primary bg-primary/10"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          ) : null}

          {/* Empty state */}
          {page.nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">
                Add a shape, text, or image from the toolbar to start designing.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NodeView({
  node,
  selected,
  assets,
  onPointerDown,
  onSelect,
}: {
  node: CanvasNode;
  selected: boolean;
  assets: DesignAsset[];
  onPointerDown: (event: React.PointerEvent, node: CanvasNode) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
}) {
  const resolvedSrc = node.kind === "image" ? resolveImageSrc(node, assets) : null;
  return (
    <div
      role="button"
      // Nodes are keyboard focusable so they can be reached with Tab and
      // selected with Enter/Space, matching pointer selection.
      tabIndex={0}
      aria-label={`${node.name} layer`}
      aria-pressed={selected}
      data-testid={`canvas-node-${node.id}`}
      className={cn(
        "absolute focus:outline-none",
        selected ? "outline outline-2 outline-primary" : "outline-none",
        // Visible keyboard focus ring that does not depend on selection state.
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        node.locked ? "cursor-default" : "cursor-move",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        opacity: node.opacity,
        transform: `rotate(${node.rotation}deg)`,
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id, event.shiftKey);
        }
      }}
    >
      {node.kind === "shape" ? <ShapeGraphic node={node} /> : null}
      {node.kind === "text" ? (
        <div
          className="flex h-full w-full overflow-hidden"
          style={{
            color: node.color,
            fontSize: node.fontSize,
            fontWeight: node.fontWeight,
            fontFamily: node.fontFamily,
            fontStyle: node.italic ? "italic" : "normal",
            textDecoration: node.underline ? "underline" : "none",
            letterSpacing: node.letterSpacing ? `${node.letterSpacing / 100}em` : undefined,
            lineHeight: node.lineHeight,
            alignItems: "center",
            justifyContent:
              node.align === "center"
                ? "center"
                : node.align === "right"
                  ? "flex-end"
                  : "flex-start",
            textAlign: node.align,
          }}
        >
          {node.text}
        </div>
      ) : null}
      {node.kind === "image" ? (
        resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={node.alt}
            draggable={false}
            className="h-full w-full"
            style={{
              objectFit: node.fit,
              objectPosition: `${node.objectPositionX}% ${node.objectPositionY}%`,
              transform: `scale(${node.flipX ? -1 : 1},${node.flipY ? -1 : 1})`,
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md bg-secondary/70 text-secondary-foreground">
            <span className="text-xs font-semibold">{node.name}</span>
            <span className="text-[10px] opacity-70">Image placeholder</span>
          </div>
        )
      ) : null}
      {node.locked ? (
        <Lock className="absolute right-1 top-1 h-3 w-3 text-muted-foreground" />
      ) : null}
    </div>
  );
}

function SelectionFrame({
  box,
  single,
  locked,
  scale,
  onHandlePointerDown,
  onRotatePointerDown,
}: {
  box: Rect;
  single: boolean;
  locked: boolean;
  scale: number;
  onHandlePointerDown: (event: React.PointerEvent, handle: ResizeHandle) => void;
  onRotatePointerDown: (event: React.PointerEvent) => void;
}) {
  const handleSize = 10 / scale;
  const half = handleSize / 2;
  const positions: Record<ResizeHandle, { left: number; top: number }> = {
    nw: { left: box.x, top: box.y },
    n: { left: box.x + box.width / 2, top: box.y },
    ne: { left: box.x + box.width, top: box.y },
    e: { left: box.x + box.width, top: box.y + box.height / 2 },
    se: { left: box.x + box.width, top: box.y + box.height },
    s: { left: box.x + box.width / 2, top: box.y + box.height },
    sw: { left: box.x, top: box.y + box.height },
    w: { left: box.x, top: box.y + box.height / 2 },
  };
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute border-2 border-primary"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      />
      {single && !locked ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute bg-primary"
            style={{
              left: box.x + box.width / 2,
              top: box.y - 24 / scale,
              width: 1,
              height: 24 / scale,
            }}
          />
          <button
            type="button"
            aria-label="Rotate selection"
            data-testid="handle-rotate"
            className="absolute rounded-full border-2 border-primary bg-background"
            style={{
              left: box.x + box.width / 2 - half,
              top: box.y - 24 / scale - half,
              width: handleSize,
              height: handleSize,
              cursor: "grab",
            }}
            onPointerDown={onRotatePointerDown}
          />
          {RESIZE_HANDLES.map((handle) => (
            <button
              key={handle}
              type="button"
              aria-label={`Resize ${handle}`}
              data-testid={`handle-${handle}`}
              className="absolute rounded-sm border-2 border-primary bg-background"
              style={{
                left: positions[handle].left - half,
                top: positions[handle].top - half,
                width: handleSize,
                height: handleSize,
                cursor: HANDLE_CURSORS[handle],
              }}
              onPointerDown={(event) => onHandlePointerDown(event, handle)}
            />
          ))}
        </>
      ) : null}
    </>
  );
}
