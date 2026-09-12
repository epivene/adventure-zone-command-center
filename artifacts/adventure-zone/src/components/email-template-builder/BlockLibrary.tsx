import { useDraggable } from "@dnd-kit/core";
import type { EmailBlockType } from "@/features/email-template-builder/email-builder-types";
import { emailBlockLabels } from "@/features/email-template-builder/email-builder-types";

const blockTypes = Object.keys(emailBlockLabels) as EmailBlockType[];

function LibraryItem({ type, onAdd }: { type: EmailBlockType; onAdd(type: EmailBlockType): void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `palette:${type}` });
  return <button
    ref={setNodeRef}
    type="button"
    className={`min-h-11 rounded-lg border bg-white px-3 py-2 text-left text-sm font-semibold shadow-sm hover:border-pink-400 ${isDragging ? "opacity-50" : ""}`}
    style={transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` } : undefined}
    onClick={() => onAdd(type)}
    aria-label={`Add ${emailBlockLabels[type]}`}
    {...listeners}
    {...attributes}
  >
    <span className="mr-2 text-pink-600" aria-hidden="true">＋</span>{emailBlockLabels[type]}
  </button>;
}

export function BlockLibrary({ onAdd }: { onAdd(type: EmailBlockType): void }) {
  return <section className="grid gap-2" aria-label="Email sections">
    <div><h3 className="font-bold">Add a section</h3><p className="text-xs text-slate-500">Tap to add or drag it onto the email.</p></div>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">{blockTypes.map((type) => <LibraryItem key={type} type={type} onAdd={onAdd} />)}</div>
  </section>;
}
