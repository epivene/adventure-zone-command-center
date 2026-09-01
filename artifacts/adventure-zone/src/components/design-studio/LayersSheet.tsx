import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Lock,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import type { FreeformEditor } from "./use-freeform-editor";

export function LayersSheet({
  editor,
  onClose,
}: {
  editor: FreeformEditor;
  onClose: () => void;
}) {
  const nodes = [...editor.page.nodes].reverse();

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45" role="dialog" aria-modal="true" aria-label="Layers">
      <div className="max-h-[76dvh] w-full overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-primary">Arrange</p>
            <h2 className="text-lg font-black">Layers</h2>
          </div>
          <Button aria-label="Close layers" onClick={onClose} size="icon" variant="ghost"><X className="h-4 w-4" /></Button>
        </div>

        <div className="max-h-[64dvh] space-y-2 overflow-y-auto p-3">
          {nodes.map((node) => {
            const selected = editor.selectedIds.includes(node.id);
            return (
              <div key={node.id} className={`rounded-xl border p-2 ${selected ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                <button
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                  onClick={() => editor.select(node.id)}
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{node.name}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{node.kind}{node.hidden ? " • hidden" : ""}{node.locked ? " • locked" : ""}</p>
                  </div>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${selected ? "bg-primary" : "bg-muted-foreground/30"}`} />
                </button>

                <div className="mt-1 flex items-center justify-end gap-1">
                  <Button aria-label={`Bring ${node.name} to front`} onClick={() => editor.reorder(node.id, "front")} size="icon" variant="ghost"><ChevronsUp className="h-4 w-4" /></Button>
                  <Button aria-label={`Bring ${node.name} forward`} onClick={() => editor.reorder(node.id, "forward")} size="icon" variant="ghost"><ChevronUp className="h-4 w-4" /></Button>
                  <Button aria-label={`Send ${node.name} backward`} onClick={() => editor.reorder(node.id, "backward")} size="icon" variant="ghost"><ChevronDown className="h-4 w-4" /></Button>
                  <Button aria-label={`Send ${node.name} to back`} onClick={() => editor.reorder(node.id, "back")} size="icon" variant="ghost"><ChevronsDown className="h-4 w-4" /></Button>
                  <Button aria-label={`${node.locked ? "Unlock" : "Lock"} ${node.name}`} onClick={() => editor.patchNodes([node.id], { locked: !node.locked })} size="icon" variant="ghost">{node.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</Button>
                </div>
              </div>
            );
          })}
          {nodes.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No layers yet.</p> : null}
        </div>
      </div>
    </div>
  );
}
