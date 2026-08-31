import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  Copy,
  ImagePlus,
  Italic,
  Layers3,
  Lock,
  Plus,
  SendToBack,
  Shapes,
  Trash2,
  Type,
  Unlock,
} from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import {
  createImageNode,
  createShapeNode,
  createTextNode,
} from "@/lib/design-studio/model";
import type { FreeformEditor } from "./use-freeform-editor";

function validColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function ContextualBottomToolbar({
  editor,
  onReplacePhoto,
  onAddPhoto,
  onOpenLayers,
}: {
  editor: FreeformEditor;
  onReplacePhoto?: () => void;
  onAddPhoto?: () => void;
  onOpenLayers?: () => void;
}) {
  const selected = editor.selectedNodes.length === 1 ? editor.selectedNodes[0]! : null;
  const multi = editor.selectedNodes.length > 1;

  if (!selected && !multi) {
    return (
      <div className="border-t border-border bg-card/95 px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,.08)] backdrop-blur" data-testid="contextual-toolbar">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Button aria-label="Add text" className="shrink-0 gap-2" disabled={!editor.canEdit} onClick={() => editor.insertNode(createTextNode())} size="sm" variant="outline">
            <Type className="h-4 w-4" />Text
          </Button>
          <Button aria-label="Add photo" className="shrink-0 gap-2" disabled={!editor.canEdit} onClick={() => onAddPhoto ? onAddPhoto() : editor.insertNode(createImageNode())} size="sm" variant="outline">
            <ImagePlus className="h-4 w-4" />Photo
          </Button>
          <Button aria-label="Add shape" className="shrink-0 gap-2" disabled={!editor.canEdit} onClick={() => editor.insertNode(createShapeNode("rectangle"))} size="sm" variant="outline">
            <Shapes className="h-4 w-4" />Shape
          </Button>
          <Button aria-label="Add star" className="shrink-0 gap-2" disabled={!editor.canEdit} onClick={() => editor.insertNode(createShapeNode("star", { fill: "#ffd21c", stroke: "#080808", strokeWidth: 6 }))} size="sm" variant="outline">
            <Plus className="h-4 w-4" />Sticker
          </Button>
          <Button aria-label="Open layers" className="shrink-0 gap-2" onClick={onOpenLayers} size="sm" variant="outline">
            <Layers3 className="h-4 w-4" />Layers
          </Button>
        </div>
      </div>
    );
  }

  if (multi) {
    return (
      <div className="border-t border-border bg-card/95 px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,.08)] backdrop-blur" data-testid="contextual-toolbar">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="shrink-0 text-xs font-bold text-muted-foreground">{editor.selectedNodes.length} selected</span>
          <Button aria-label="Duplicate" className="shrink-0 gap-1.5" disabled={!editor.canEdit} onClick={editor.duplicateSelected} size="sm" variant="outline"><Copy className="h-4 w-4" />Duplicate</Button>
          <Button aria-label="Delete" className="shrink-0 gap-1.5 text-destructive" disabled={!editor.canEdit} onClick={editor.removeSelected} size="sm" variant="outline"><Trash2 className="h-4 w-4" />Delete</Button>
        </div>
      </div>
    );
  }

  const locked = selected!.locked;

  return (
    <div className="border-t border-border bg-card/95 px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,.08)] backdrop-blur" data-testid="contextual-toolbar">
      {selected!.kind === "text" ? (
        <div className="mb-2 grid grid-cols-[1fr_5.5rem_auto] gap-2">
          <Input
            aria-label="Text content"
            disabled={!editor.canEdit || locked}
            onChange={(event) => editor.patchSelected({ text: event.target.value })}
            value={selected!.text}
          />
          <Input
            aria-label="Text size"
            disabled={!editor.canEdit || locked}
            min={8}
            max={300}
            onChange={(event) => editor.patchSelected({ fontSize: Math.max(8, Number(event.target.value) || 8) })}
            type="number"
            value={Math.round(selected!.fontSize)}
          />
          <label className="flex h-9 w-10 items-center justify-center rounded-md border border-border bg-background" title="Text color">
            <span className="sr-only">Text color</span>
            <input
              aria-label="Text color"
              className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
              disabled={!editor.canEdit || locked}
              onChange={(event) => editor.patchSelected({ color: event.target.value })}
              type="color"
              value={validColor(selected!.color, "#080808")}
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {selected!.kind === "text" ? (
          <>
            <Button aria-label="Bold" className="shrink-0" disabled={!editor.canEdit || locked} onClick={() => editor.patchSelected({ fontWeight: selected!.fontWeight >= 700 ? 400 : 800 })} size="icon" variant={selected!.fontWeight >= 700 ? "default" : "outline"}><Bold className="h-4 w-4" /></Button>
            <Button aria-label="Italic" className="shrink-0" disabled={!editor.canEdit || locked} onClick={() => editor.patchSelected({ italic: !selected!.italic })} size="icon" variant={selected!.italic ? "default" : "outline"}><Italic className="h-4 w-4" /></Button>
            <Button aria-label="Align left" className="shrink-0" disabled={!editor.canEdit || locked} onClick={() => editor.patchSelected({ align: "left" })} size="icon" variant={selected!.align === "left" ? "default" : "outline"}><AlignLeft className="h-4 w-4" /></Button>
            <Button aria-label="Align center" className="shrink-0" disabled={!editor.canEdit || locked} onClick={() => editor.patchSelected({ align: "center" })} size="icon" variant={selected!.align === "center" ? "default" : "outline"}><AlignCenter className="h-4 w-4" /></Button>
            <Button aria-label="Align right" className="shrink-0" disabled={!editor.canEdit || locked} onClick={() => editor.patchSelected({ align: "right" })} size="icon" variant={selected!.align === "right" ? "default" : "outline"}><AlignRight className="h-4 w-4" /></Button>
          </>
        ) : null}

        {selected!.kind === "image" ? (
          <>
            <Button aria-label="Replace photo" className="shrink-0 gap-2" disabled={!editor.canEdit || locked} onClick={onReplacePhoto} size="sm" variant="outline"><ImagePlus className="h-4 w-4" />Replace photo</Button>
            <Button aria-label="Toggle photo fit" className="shrink-0" disabled={!editor.canEdit || locked} onClick={() => editor.patchSelected({ fit: selected!.fit === "cover" ? "contain" : "cover" })} size="sm" variant="outline">{selected!.fit === "cover" ? "Fit" : "Fill"}</Button>
          </>
        ) : null}

        {selected!.kind === "shape" ? (
          <label className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold">
            Fill
            <input
              aria-label="Shape fill color"
              className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
              disabled={!editor.canEdit || locked}
              onChange={(event) => editor.patchSelected({ fill: event.target.value })}
              type="color"
              value={validColor(selected!.fill, "#ff1791")}
            />
          </label>
        ) : null}

        <Button aria-label="Bring forward" className="shrink-0" disabled={!editor.canEdit} onClick={() => editor.reorder(selected!.id, "forward")} size="icon" variant="outline"><BringToFront className="h-4 w-4" /></Button>
        <Button aria-label="Send backward" className="shrink-0" disabled={!editor.canEdit} onClick={() => editor.reorder(selected!.id, "backward")} size="icon" variant="outline"><SendToBack className="h-4 w-4" /></Button>
        <Button aria-label={locked ? "Unlock" : "Lock"} className="shrink-0 gap-1.5" disabled={!editor.canEdit} onClick={() => editor.patchSelected({ locked: !locked })} size="sm" variant="outline">{locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{locked ? "Unlock" : "Lock"}</Button>
        <Button aria-label="Duplicate" className="shrink-0 gap-1.5" disabled={!editor.canEdit} onClick={editor.duplicateSelected} size="sm" variant="outline"><Copy className="h-4 w-4" />Duplicate</Button>
        <Button aria-label="Delete" className="shrink-0 gap-1.5 text-destructive" disabled={!editor.canEdit} onClick={editor.removeSelected} size="sm" variant="outline"><Trash2 className="h-4 w-4" />Delete</Button>
      </div>
    </div>
  );
}
