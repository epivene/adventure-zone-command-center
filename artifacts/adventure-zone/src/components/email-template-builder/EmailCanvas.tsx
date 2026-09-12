import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { EmailBuilderBlock } from "@workspace/api-zod";
import { emailBlockLabels } from "@/features/email-template-builder/email-builder-types";

function blockSummary(block: EmailBuilderBlock): string {
  switch (block.type) {
    case "hero": return `${block.eyebrow} · ${block.headline} ${block.highlightedText}`;
    case "text": return block.content;
    case "logoHeader": return block.altText;
    case "image":
    case "videoThumbnail": return block.altText;
    case "packageCards": return block.cards.map((card) => card.label.replaceAll("\n", " ")).join(" · ");
    case "offerCallout": return `${block.eyebrow} · ${block.title}`;
    case "buttonRow": return block.buttons.map((button) => button.label).join(" · ");
    case "signature": return block.closing;
    case "footer": return `${block.businessName} · ${block.tagline}`;
    case "divider": return "Decorative divider";
    case "spacer": return `${block.height}px space`;
    case "customHtml": return "Preserved advanced HTML";
  }
}

function SortableBlock({ block, index, total, selected, onSelect, onMove, onDuplicate, onDelete }: {
  block: EmailBuilderBlock;
  index: number;
  total: number;
  selected: boolean;
  onSelect(id: string): void;
  onMove(id: string, toIndex: number): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const label = emailBlockLabels[block.type];
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded-lg border-2 bg-white p-3 ${selected ? "border-pink-500 ring-2 ring-pink-100" : "border-slate-200"} ${isDragging ? "opacity-60" : ""}`}>
    <div className="flex items-start justify-between gap-2">
      <button type="button" className="min-h-11 cursor-grab rounded-md border px-3 text-lg" aria-label={`Drag ${label}`} {...attributes} {...listeners}>⠿</button>
      <button type="button" className="min-h-11 min-w-0 flex-1 text-left" aria-label={`Edit ${label}`} onClick={() => onSelect(block.id)}>
        <span className="block font-bold">{label}</span>
        <span className="line-clamp-2 text-xs text-slate-500">{blockSummary(block)}</span>
      </button>
    </div>
    <div className="mt-2 grid grid-cols-4 gap-1">
      <button type="button" className="min-h-11 rounded border text-xs" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(block.id, index - 1)}>↑ Up</button>
      <button type="button" className="min-h-11 rounded border text-xs" aria-label={`Move ${label} down`} disabled={index === total - 1} onClick={() => onMove(block.id, index + 1)}>↓ Down</button>
      <button type="button" className="min-h-11 rounded border text-xs" aria-label={`Duplicate ${label}`} onClick={() => onDuplicate(block.id)}>Copy</button>
      <button type="button" className="min-h-11 rounded border text-xs text-rose-700" aria-label={`Delete ${label}`} disabled={total === 1} onClick={() => onDelete(block.id)}>Delete</button>
    </div>
  </article>;
}

export function EmailCanvas(props: {
  blocks: EmailBuilderBlock[];
  selectedId: string | null;
  onSelect(id: string): void;
  onMove(id: string, toIndex: number): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
}) {
  return <section className="grid min-w-0 gap-2 rounded-xl bg-slate-100 p-3" role="region" aria-label="Email canvas">
    <SortableContext items={props.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
      {props.blocks.map((block, index) => <SortableBlock key={block.id} block={block} index={index} total={props.blocks.length} selected={block.id === props.selectedId} onSelect={props.onSelect} onMove={props.onMove} onDuplicate={props.onDuplicate} onDelete={props.onDelete} />)}
    </SortableContext>
  </section>;
}
