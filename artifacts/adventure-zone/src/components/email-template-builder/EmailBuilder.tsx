import { useEffect, useMemo, useReducer, useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { EmailBuilderDocument } from "@workspace/api-zod";

import { BlockLibrary } from "./BlockLibrary";
import { BlockSettings } from "./BlockSettings";
import { EmailCanvas } from "./EmailCanvas";
import { EmailBuilderPreview } from "./EmailBuilderPreview";
import { builderReducer, createBuilderHistory } from "@/features/email-template-builder/email-builder-history";
import { createEmailBlock, type EmailBlockType } from "@/features/email-template-builder/email-builder-types";
import { importLegacyEmail } from "@/features/email-template-builder/legacy-email-import";

export function EmailBuilder({ value, onChange, previewHtml }: { value: EmailBuilderDocument; onChange(value: EmailBuilderDocument): void; previewHtml: string }) {
  const [history, dispatch] = useReducer(builderReducer, value, createBuilderHistory);
  const [selectedId, setSelectedId] = useState<string | null>(value.blocks[0]?.id ?? null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedHtml, setAdvancedHtml] = useState(previewHtml);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => { onChange(history.present); }, [history.present, onChange]);
  useEffect(() => { setAdvancedHtml(previewHtml); }, [previewHtml]);

  const selected = useMemo(() => history.present.blocks.find((block) => block.id === selectedId) ?? null, [history.present.blocks, selectedId]);

  function add(type: EmailBlockType, atIndex?: number) {
    const block = createEmailBlock(type);
    dispatch({ type: "add", block, atIndex });
    setSelectedId(block.id);
  }
  function move(id: string, toIndex: number) { dispatch({ type: "move", id, toIndex }); }
  function duplicate(id: string) {
    const block = history.present.blocks.find((item) => item.id === id);
    if (!block) return;
    const newId = `${block.type}-${globalThis.crypto.randomUUID()}`;
    dispatch({ type: "duplicate", id, newId });
    setSelectedId(newId);
  }
  function remove(id: string) {
    const index = history.present.blocks.findIndex((block) => block.id === id);
    dispatch({ type: "remove", id });
    if (selectedId === id) setSelectedId(history.present.blocks[index + 1]?.id ?? history.present.blocks[index - 1]?.id ?? null);
  }
  function dragEnded(event: DragEndEvent) {
    const activeId = String(event.active.id);
    if (activeId.startsWith("palette:")) {
      const atIndex = event.over ? history.present.blocks.findIndex((block) => block.id === event.over?.id) : -1;
      add(activeId.slice(8) as EmailBlockType, atIndex >= 0 ? atIndex : undefined);
      return;
    }
    if (!event.over || event.over.id === event.active.id) return;
    const toIndex = history.present.blocks.findIndex((block) => block.id === event.over?.id);
    if (toIndex >= 0) move(activeId, toIndex);
  }

  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnded}>
    <section className="grid gap-4" aria-label="Visual email builder">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <button type="button" className="button-secondary" aria-label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })}>↶ Undo</button>
        <button type="button" className="button-secondary" aria-label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: "redo" })}>↷ Redo</button>
        <button type="button" className="button-secondary ml-auto" onClick={() => setShowAdvanced((open) => !open)}>{showAdvanced ? "Hide advanced HTML" : "Advanced HTML"}</button>
      </div>
      {showAdvanced ? <section className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3"><label className="grid gap-1 text-sm font-bold">Whole email HTML<textarea rows={16} className="font-mono text-xs" value={advancedHtml} onChange={(event) => setAdvancedHtml(event.target.value)} /></label><p className="text-xs text-amber-900">Unsupported sections will be kept as editable Custom HTML blocks.</p><div><button type="button" className="button-secondary" onClick={() => { if (!window.confirm("Apply this HTML? Unsupported sections will become Custom HTML blocks.")) return; const imported = importLegacyEmail(advancedHtml); dispatch({ type: "reset", document: imported.document }); setSelectedId(imported.document.blocks[0]?.id ?? null); setShowAdvanced(false); }}>Apply HTML to builder</button></div></section> : null}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[15rem_minmax(20rem,1fr)_20rem]">
        <div id="email-block-library" className="order-3 scroll-mt-24 xl:order-1"><BlockLibrary onAdd={add} /></div>
        <div className="order-1 xl:order-2"><EmailCanvas blocks={history.present.blocks} selectedId={selectedId} onSelect={setSelectedId} onMove={move} onDuplicate={duplicate} onDelete={remove} /></div>
        <div id="email-block-settings" className="order-2 scroll-mt-24 xl:order-3"><BlockSettings block={selected} onUpdate={(patch) => selected && dispatch({ type: "update", id: selected.id, patch })} /></div>
      </div>
      <nav className="sticky bottom-2 z-20 grid grid-cols-2 gap-2 rounded-xl border bg-white/95 p-2 shadow-lg backdrop-blur xl:hidden" aria-label="Mobile editor panels"><a className="button-secondary text-center" href="#email-block-library">＋ Add sections</a><a className="button-secondary text-center" href="#email-block-settings">Edit section</a></nav>
      <EmailBuilderPreview html={previewHtml} />
    </section>
  </DndContext>;
}
