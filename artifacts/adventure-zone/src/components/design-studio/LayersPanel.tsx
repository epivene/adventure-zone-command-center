import { Eye, EyeOff, GripVertical, Image as ImageIcon, Lock, Shapes, Type, Unlock } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { cn } from "@workspace/avz-crm/lib/utils";
import type { CanvasNode } from "@/lib/design-studio/model";
import { moveNodeToIndex } from "@/lib/design-studio/commands";
import type { FreeformEditor } from "./use-freeform-editor";

function KindIcon({ node }: { node: CanvasNode }) {
  if (node.kind === "text") return <Type className="h-3.5 w-3.5" />;
  if (node.kind === "image") return <ImageIcon className="h-3.5 w-3.5" />;
  return <Shapes className="h-3.5 w-3.5" />;
}

/**
 * Layer list mirrors the z-stack (top layer first). Supports selecting,
 * hide/lock toggles, and drag-to-reorder via the HTML5 DnD API. Reorder commits
 * one history entry.
 */
export function LayersPanel({ editor }: { editor: FreeformEditor }) {
  const { page, selectedIds, canEdit } = editor;
  const ordered = [...page.nodes].reverse(); // topmost first

  const onDrop = (fromId: string, toDisplayIndex: number) => {
    // Convert reversed display index back into z-index (array order).
    const targetZ = page.nodes.length - 1 - toDisplayIndex;
    editor.commitDoc(moveNodeToIndex(editor.doc, fromId, targetZ));
  };

  if (page.nodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No layers yet. Add a shape, text, or image to see it here.
      </p>
    );
  }

  return (
    <div className="grid gap-1" data-testid="layers-panel">
      {ordered.map((node, displayIndex) => {
        const selected = selectedIds.includes(node.id);
        return (
          <div
            key={node.id}
            draggable={canEdit && !node.locked}
            onDragStart={(event) => event.dataTransfer.setData("text/plain", node.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const fromId = event.dataTransfer.getData("text/plain");
              if (fromId && fromId !== node.id) onDrop(fromId, displayIndex);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors",
              selected ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted",
            )}
            data-testid={`layer-row-${node.id}`}
          >
            {canEdit ? (
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
            ) : null}
            <button
              type="button"
              className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left", selected ? "font-semibold text-primary" : "text-foreground")}
              onClick={(event) => editor.select(node.id, event.shiftKey)}
              data-testid={`button-select-layer-${node.id}`}
            >
              <span className="shrink-0 text-muted-foreground"><KindIcon node={node} /></span>
              <span className="truncate">{node.name}</span>
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={!canEdit}
              onClick={() => editor.patchNodes([node.id], { hidden: !node.hidden })}
              aria-label={node.hidden ? "Show layer" : "Hide layer"}
              data-testid={`button-toggle-hidden-${node.id}`}
            >
              {node.hidden ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={!canEdit}
              onClick={() => editor.patchNodes([node.id], { locked: !node.locked })}
              aria-label={node.locked ? "Unlock layer" : "Lock layer"}
              data-testid={`button-toggle-lock-${node.id}`}
            >
              {node.locked ? <Lock className="h-3.5 w-3.5 text-primary" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
