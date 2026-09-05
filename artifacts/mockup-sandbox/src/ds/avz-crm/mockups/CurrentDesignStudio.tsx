import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Circle,
  Copy,
  Download,
  FileImage,
  FileText,
  ImagePlus,
  Layers3,
  Plus,
  RectangleHorizontal,
  Redo2,
  Save,
  Star,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";

type Layer = {
  id: string;
  name: string;
  kind: "text" | "shape" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  text?: string;
  color?: string;
  fill?: string;
  fontSize?: number;
  fontWeight?: number;
  image?: string;
};

const INITIAL_LAYERS: Layer[] = [
  { id: "background", name: "Email background", kind: "shape", x: 0, y: 0, width: 960, height: 720, fill: "#fff9f5" },
  { id: "hero", name: "Hero photo", kind: "image", x: 42, y: 42, width: 876, height: 304, image: "https://images.unsplash.com/photo-1504150558240-0b4fd8946624?auto=format&fit=crop&w=1400&q=85" },
  { id: "pink-strip", name: "Pink brush banner", kind: "shape", x: 72, y: 300, width: 548, height: 92, rotation: -2, fill: "#ff1791" },
  { id: "headline", name: "Email headline", kind: "text", x: 92, y: 306, width: 510, height: 78, rotation: -2, text: "YOUR NEXT ADVENTURE", color: "#ffffff", fontSize: 48, fontWeight: 900 },
  { id: "body", name: "Email body copy", kind: "text", x: 76, y: 430, width: 520, height: 118, text: "Big skies, bold stories, and unforgettable Wyoming moments are waiting. Bring your group to Adventure Zone this summer.", color: "#080808", fontSize: 25, fontWeight: 700 },
  { id: "cta", name: "Book now button", kind: "shape", x: 76, y: 582, width: 278, height: 76, rotation: -1, fill: "#ffd21c" },
  { id: "cta-label", name: "Button label", kind: "text", x: 102, y: 590, width: 228, height: 58, rotation: -1, text: "PLAN YOUR VISIT →", color: "#080808", fontSize: 25, fontWeight: 900 },
  { id: "sticker", name: "Summer sticker", kind: "shape", x: 682, y: 384, width: 180, height: 180, rotation: 7, fill: "#ffd21c" },
  { id: "sticker-text", name: "Sticker text", kind: "text", x: 706, y: 424, width: 132, height: 96, rotation: 7, text: "SUMMER\n2025", color: "#080808", fontSize: 34, fontWeight: 900 },
];

type Sheet = "layers" | "elements" | "export" | "photos" | null;

function LayerView({ layer, selected, onSelect }: { layer: Layer; selected: boolean; onSelect: () => void }) {
  const style = {
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    transform: `rotate(${layer.rotation ?? 0}deg)`,
  };
  if (layer.id === "background") return <div className="absolute inset-0" style={{ background: layer.fill }} />;
  return (
    <div
      aria-pressed={selected}
      className={`absolute cursor-move focus:outline-none ${selected ? "outline outline-2 outline-primary" : ""}`}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      role="button"
      style={style}
      tabIndex={0}
    >
      {layer.kind === "image" ? (
        <img alt="Families enjoying an outdoor Wyoming adventure" className="h-full w-full object-cover" draggable={false} src={layer.image} />
      ) : null}
      {layer.kind === "shape" ? (
        <div
          className={`h-full w-full ${layer.id === "sticker" ? "[clip-path:polygon(50%_0%,61%_28%,85%_15%,72%_39%,100%_50%,72%_61%,85%_85%,61%_72%,50%_100%,39%_72%,15%_85%,28%_61%,0%_50%,28%_39%,15%_15%,39%_28%)]" : ""}`}
          style={{ background: layer.fill, border: layer.id === "cta" ? "5px solid #080808" : undefined }}
        />
      ) : null}
      {layer.kind === "text" ? (
        <div
          className="flex h-full w-full items-center whitespace-pre-line leading-[1.05]"
          style={{
            color: layer.color,
            fontFamily: layer.fontWeight === 900 ? "Impact, sans-serif" : "DM Sans, sans-serif",
            fontSize: layer.fontSize,
            fontWeight: layer.fontWeight,
          }}
        >
          {layer.text}
        </div>
      ) : null}
      {selected ? (
        <>
          <span className="absolute -left-1.5 -top-1.5 h-3 w-3 border-2 border-primary bg-background" />
          <span className="absolute -right-1.5 -top-1.5 h-3 w-3 border-2 border-primary bg-background" />
          <span className="absolute -bottom-1.5 -left-1.5 h-3 w-3 border-2 border-primary bg-background" />
          <span className="absolute -bottom-1.5 -right-1.5 h-3 w-3 border-2 border-primary bg-background" />
        </>
      ) : null}
    </div>
  );
}

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div aria-modal="true" className="fixed inset-0 z-50 flex items-end bg-black/45" role="dialog">
      <div className="max-h-[76dvh] w-full overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
            <h2 className="text-lg font-black">{title}</h2>
          </div>
          <Button aria-label="Close" onClick={onClose} size="icon" variant="ghost"><X className="h-4 w-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CurrentDesignStudio() {
  const [name, setName] = useState("Summer Adventure Email");
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [zoom, setZoom] = useState(0.75);
  const [dirty, setDirty] = useState(false);
  const selected = useMemo(() => layers.find((layer) => layer.id === selectedId) ?? null, [layers, selectedId]);

  function addText() {
    const id = `text-${layers.length}`;
    setLayers((current) => [...current, { id, name: "New text", kind: "text", x: 290, y: 350, width: 390, height: 72, text: "ADD YOUR TEXT", color: "#080808", fontSize: 42, fontWeight: 900 }]);
    setSelectedId(id);
    setDirty(true);
    setSheet(null);
  }

  function removeSelected() {
    if (!selectedId) return;
    setLayers((current) => current.filter((layer) => layer.id !== selectedId));
    setSelectedId(null);
    setDirty(true);
  }

  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-background" data-testid="design-editor">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button aria-label="Back to Design Studio" size="icon" variant="outline"><ArrowLeft className="h-4 w-4" /></Button>
          <Input
            aria-label="Project name"
            className="min-w-0 max-w-sm"
            onChange={(event) => { setName(event.target.value); setDirty(true); }}
            value={name}
          />
          <Badge className="hidden capitalize sm:inline-flex" variant="outline">email</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button aria-label="Undo" disabled={!dirty} size="icon" variant="ghost"><Undo2 className="h-4 w-4" /></Button>
          <Button aria-label="Redo" disabled size="icon" variant="ghost"><Redo2 className="h-4 w-4" /></Button>
          <Button aria-label="Zoom out" disabled={zoom <= 0.25} onClick={() => setZoom(Math.max(0.25, zoom - 0.1))} size="icon" variant="ghost"><ZoomOut className="h-4 w-4" /></Button>
          <span className="hidden min-w-12 text-center text-xs font-semibold text-muted-foreground sm:inline">{Math.round(zoom * 100)}%</span>
          <Button aria-label="Zoom in" disabled={zoom >= 1} onClick={() => setZoom(Math.min(1, zoom + 0.1))} size="icon" variant="ghost"><ZoomIn className="h-4 w-4" /></Button>
          <Button aria-label="Export design" onClick={() => setSheet("export")} size="icon" variant="ghost"><Download className="h-4 w-4" /></Button>
          <Button className="ml-1 gap-1.5" onClick={() => setDirty(false)} size="sm">
            {dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            <span className="hidden sm:inline">{dirty ? "Save" : "Saved"}</span>
          </Button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col" data-testid="design-canvas">
        <div className="flex flex-1 items-start justify-center overflow-auto bg-muted/40 p-6" onClick={() => setSelectedId(null)}>
          <div style={{ height: 720 * zoom, width: 960 * zoom }}>
            <div
              className="relative select-none overflow-hidden rounded-xl border-2 border-border shadow-2xl"
              style={{ height: 720, transform: `scale(${zoom})`, transformOrigin: "top left", width: 960 }}
            >
              {layers.map((layer) => <LayerView key={layer.id} layer={layer} onSelect={() => setSelectedId(layer.id)} selected={selectedId === layer.id} />)}
            </div>
          </div>
        </div>
      </main>

      <div className="relative z-20">
        <div className="border-t border-border bg-card/95 px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,.08)] backdrop-blur">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {selected ? (
              <>
                <span className="shrink-0 text-xs font-bold text-muted-foreground">{selected.name}</span>
                <Button className="shrink-0 gap-1.5" size="sm" variant="outline"><Copy className="h-4 w-4" />Duplicate</Button>
                {selected.kind === "image" ? <Button className="shrink-0 gap-1.5" onClick={() => setSheet("photos")} size="sm" variant="outline"><ImagePlus className="h-4 w-4" />Replace</Button> : null}
                <Button className="shrink-0 gap-1.5" onClick={removeSelected} size="sm" variant="outline"><Trash2 className="h-4 w-4" />Delete</Button>
                <Button className="shrink-0 gap-1.5" onClick={() => setSheet("layers")} size="sm" variant="outline"><Layers3 className="h-4 w-4" />Layers</Button>
              </>
            ) : (
              <>
                <Button className="shrink-0 gap-2" onClick={addText} size="sm" variant="outline"><Type className="h-4 w-4" />Text</Button>
                <Button className="shrink-0 gap-2" onClick={() => setSheet("photos")} size="sm" variant="outline"><ImagePlus className="h-4 w-4" />Photo</Button>
                <Button className="shrink-0 gap-2" onClick={() => setSheet("elements")} size="sm" variant="outline"><Plus className="h-4 w-4" />Elements</Button>
                <Button className="shrink-0 gap-2" onClick={() => setSheet("layers")} size="sm" variant="outline"><Layers3 className="h-4 w-4" />Layers</Button>
              </>
            )}
          </div>
        </div>
        <div className="border-t border-border bg-card px-3 py-2">
          <span className="block truncate text-[11px] text-muted-foreground">{selected ? "1 layer selected" : "Tap a layer to edit it"}</span>
        </div>
      </div>

      {sheet === "layers" ? (
        <ModalShell eyebrow="Arrange" onClose={() => setSheet(null)} title="Layers">
          <div className="max-h-[64dvh] space-y-2 overflow-y-auto p-3">
            {[...layers].reverse().filter((layer) => layer.id !== "background").map((layer) => (
              <Button
                className="w-full justify-between"
                key={layer.id}
                onClick={() => { setSelectedId(layer.id); setSheet(null); }}
                variant={selectedId === layer.id ? "default" : "outline"}
              >
                <span>{layer.name}</span><span className="text-[10px] uppercase">{layer.kind}</span>
              </Button>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {sheet === "elements" ? (
        <ModalShell eyebrow="Build the poster" onClose={() => setSheet(null)} title="Add an element">
          <div className="grid max-h-[60dvh] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
            {[
              ["Text", "Add a headline or detail", Type],
              ["Pink brush banner", "Meeteetse-style headline strip", RectangleHorizontal],
              ["Yellow sticker block", "Dates, locations, callouts", RectangleHorizontal],
              ["Price bubble", "Round ticket or price callout", Circle],
              ["Star sticker", "Carnival-style accent", Star],
            ].map(([label, description, Icon]) => (
              <Button className="h-auto items-start justify-start" key={String(label)} onClick={addText} variant="outline">
                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <span className="text-left"><span className="block font-black">{String(label)}</span><span className="block text-xs font-normal opacity-70">{String(description)}</span></span>
              </Button>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {sheet === "export" ? (
        <ModalShell eyebrow="Take it with you" onClose={() => setSheet(null)} title="Export design">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Button className="h-auto justify-start gap-3" onClick={() => setSheet(null)} variant="outline"><FileImage className="h-6 w-6" /><span className="text-left"><strong className="block">PNG image</strong><small>Best for email graphics and quick sharing.</small></span></Button>
            <Button className="h-auto justify-start gap-3" onClick={() => setSheet(null)} variant="outline"><FileText className="h-6 w-6" /><span className="text-left"><strong className="block">PDF design</strong><small>Best for printing and document sharing.</small></span></Button>
          </div>
        </ModalShell>
      ) : null}

      {sheet === "photos" ? (
        <ModalShell eyebrow="Adventure Zone media" onClose={() => setSheet(null)} title={selected?.kind === "image" ? "Replace photo" : "Add photo"}>
          <div className="grid grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
            {[
              ["Wyoming family adventure", "https://images.unsplash.com/photo-1504150558240-0b4fd8946624?auto=format&fit=crop&w=600&q=80"],
              ["Mountain trail", "https://images.unsplash.com/photo-1464278533981-50106e6176b1?auto=format&fit=crop&w=600&q=80"],
              ["Summer campfire", "https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&w=600&q=80"],
            ].map(([label, image]) => (
              <Button className="h-auto flex-col items-stretch gap-2" key={label} onClick={() => setSheet(null)} variant="outline">
                <img alt={label} className="aspect-[4/3] w-full object-cover" src={image} /><span>{label}</span>
              </Button>
            ))}
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}