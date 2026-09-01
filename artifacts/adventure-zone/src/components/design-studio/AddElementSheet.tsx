import { ArrowRight, Circle, RectangleHorizontal, Star, Type, X } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  createShapeNode,
  createTextNode,
  type CanvasNode,
} from "@/lib/design-studio/model";
import type { FreeformEditor } from "./use-freeform-editor";

const PINK = "#ff1791";
const YELLOW = "#ffd21c";
const BLACK = "#080808";
const WHITE = "#ffffff";

export function AddElementSheet({
  editor,
  onClose,
}: {
  editor: FreeformEditor;
  onClose: () => void;
}) {
  function add(node: CanvasNode) {
    editor.insertNode(node);
    onClose();
  }

  const elements = [
    {
      label: "Text",
      description: "Add a headline or detail",
      icon: <Type className="h-5 w-5" />,
      create: () => createTextNode({ name: "New text", text: "ADD YOUR TEXT", fontFamily: "Impact", fontSize: 48, fontWeight: 800, color: BLACK, width: 420, height: 90 }),
    },
    {
      label: "Pink brush banner",
      description: "Meeteetse-style headline strip",
      icon: <RectangleHorizontal className="h-5 w-5" />,
      create: () => createShapeNode("rectangle", { name: "Pink brush banner", width: 430, height: 88, rotation: -2, fill: PINK, stroke: PINK, strokeWidth: 0 }),
    },
    {
      label: "Yellow sticker block",
      description: "Dates, locations, callouts",
      icon: <RectangleHorizontal className="h-5 w-5" />,
      create: () => createShapeNode("rectangle", { name: "Yellow sticker block", width: 360, height: 150, rotation: 1, fill: YELLOW, stroke: BLACK, strokeWidth: 7 }),
    },
    {
      label: "Price bubble",
      description: "Round ticket or price callout",
      icon: <Circle className="h-5 w-5" />,
      create: () => createShapeNode("circle", { name: "Price bubble", width: 190, height: 190, rotation: -4, fill: WHITE, stroke: PINK, strokeWidth: 9 }),
    },
    {
      label: "Star sticker",
      description: "Carnival-style accent",
      icon: <Star className="h-5 w-5" />,
      create: () => createShapeNode("star", { name: "Star sticker", width: 130, height: 130, rotation: 8, fill: YELLOW, stroke: BLACK, strokeWidth: 7 }),
    },
    {
      label: "Arrow",
      description: "Point to dates, locations, or CTA",
      icon: <ArrowRight className="h-5 w-5" />,
      create: () => createShapeNode("arrow", { name: "Arrow", width: 220, height: 18, rotation: -8, fill: PINK, stroke: PINK, strokeWidth: 12 }),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45" role="dialog" aria-modal="true" aria-label="Add element">
      <div className="max-h-[72dvh] w-full overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-primary">Build the poster</p>
            <h2 className="text-lg font-black">Add an element</h2>
          </div>
          <Button aria-label="Close add element" onClick={onClose} size="icon" variant="ghost"><X className="h-4 w-4" /></Button>
        </div>

        <div className="grid max-h-[60dvh] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
          {elements.map((item) => (
            <button
              key={item.label}
              className="rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary hover:shadow-md"
              onClick={() => add(item.create())}
              type="button"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/50 text-primary">{item.icon}</div>
              <p className="text-sm font-black">{item.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
