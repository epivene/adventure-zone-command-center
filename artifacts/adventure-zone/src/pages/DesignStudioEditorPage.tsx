import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  FilePenLine,
  Image,
  Lock,
  Minus,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
} from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@workspace/avz-crm/components/ui/alert-dialog";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { DESIGN_TYPES, designStudioApi, type DesignProject, type DesignType } from "@/lib/design-studio-api";

type ElementKind = "text" | "image" | "shape";
type StudioElement = {
  id: string;
  kind: ElementKind;
  label: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  color: string;
};
type StudioPage = { id: string; name: string; background: string; elements: StudioElement[] };
type StudioCanvas = { activePageId: string; pages: StudioPage[] };

const documentTypes = new Set<DesignType>(["email", "review request", "contract"]);
const blockNames = ["Header", "Event details", "Personalized message", "Call to action", "Protected footer"];
const colors = { text: "#2d241c", shape: "#e8752a", image: "#d8c8b6" };

function newElement(kind: ElementKind, index: number): StudioElement {
  return {
    id: `${kind}-${Date.now()}-${index}`,
    kind,
    label: kind === "text" ? "Headline" : kind === "image" ? "Brand image" : "Accent shape",
    text: kind === "text" ? "Your next adventure starts here" : undefined,
    x: 14 + index * 3,
    y: 18 + index * 9,
    width: kind === "shape" ? 34 : 62,
    height: kind === "shape" ? 14 : 18,
    rotation: 0,
    opacity: 1,
    locked: false,
    color: colors[kind],
  };
}

function readCanvas(project: DesignProject): StudioCanvas {
  const value = project.canvas as Partial<StudioCanvas> | null | undefined;
  const pages = Array.isArray(value?.pages) && value.pages.length > 0 ? value.pages : [{
    id: "page-1",
    name: "Page 1",
    background: "#fffaf4",
    elements: [newElement("text", 0)],
  }];
  return { activePageId: value?.activePageId ?? pages[0]!.id, pages: pages as StudioPage[] };
}

function isDocument(type: DesignType) {
  return documentTypes.has(type);
}

export default function DesignStudioEditorPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [project, setProject] = useState<DesignProject | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<DesignType>("blank");
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState("");
  const [canvas, setCanvas] = useState<StudioCanvas | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<StudioCanvas[]>([]);
  const [future, setFuture] = useState<StudioCanvas[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    designStudioApi.get(params.id).then((value) => {
      setProject(value);
      setName(value.name);
      setType(value.type);
      setContent(value.content ?? "");
      setNotes(value.notes ?? "");
      setCanvas(readCanvas(value));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Project could not be loaded."))
      .finally(() => setLoading(false));
  }, [params.id]);

  const activePage = canvas?.pages.find((page) => page.id === canvas.activePageId) ?? canvas?.pages[0] ?? null;
  const selected = activePage?.elements.find((element) => element.id === selectedId) ?? null;

  function changeCanvas(change: (current: StudioCanvas) => StudioCanvas) {
    if (!canvas) return;
    setHistory((items) => [...items.slice(-19), canvas]);
    setFuture([]);
    setCanvas(change(canvas));
    setDirty(true);
    setSaved(false);
  }

  function updateSelected(change: Partial<StudioElement>) {
    if (!selected || selected.locked) return;
    changeCanvas((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id !== current.activePageId ? page : {
        ...page,
        elements: page.elements.map((element) => element.id === selected.id ? { ...element, ...change } : element),
      }),
    }));
  }

  function addElement(kind: ElementKind) {
    changeCanvas((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id !== current.activePageId ? page : {
        ...page,
        elements: [...page.elements, newElement(kind, page.elements.length)],
      }),
    }));
  }

  function undo() {
    const previous = history.at(-1);
    if (!canvas || !previous) return;
    setFuture((items) => [...items, canvas]);
    setHistory((items) => items.slice(0, -1));
    setCanvas(previous);
    setDirty(true);
  }

  function redo() {
    const next = future.at(-1);
    if (!canvas || !next) return;
    setHistory((items) => [...items, canvas]);
    setFuture((items) => items.slice(0, -1));
    setCanvas(next);
    setDirty(true);
  }

  async function save() {
    if (!params.id || !name.trim() || !canvas) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const value = await designStudioApi.update(params.id, { name: name.trim(), type, content, notes, canvas, syncState: "synced" });
      setProject(value);
      setDirty(false);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dirty || loading || saving) return;
    const timer = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, canvas, content, notes, name, type]);

  async function remove() {
    if (!params.id) return;
    try {
      await designStudioApi.remove(params.id);
      setLocation("/design-studio");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project could not be archived.");
    }
  }

  async function prepareOutput(outputType: "preview" | "export" | "gmail_draft" | "review_request" | "contract") {
    if (!params.id) return;
    setActionMessage(null);
    try {
      if (outputType === "contract") {
        await designStudioApi.prepareContract(params.id);
        setActionMessage("Signing packet prepared from this frozen version. No one was notified or asked to sign.");
      } else {
        await designStudioApi.createOutput(params.id, outputType);
        setActionMessage(outputType === "gmail_draft" ? "Gmail draft prepared. Review it in Gmail before sending." : `${outputType === "preview" ? "Preview" : "Output"} prepared from the saved version.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That output could not be prepared.");
    }
  }

  async function copyProject(repurpose = false) {
    if (!params.id) return;
    try {
      const copy = repurpose ? await designStudioApi.repurpose(params.id) : await designStudioApi.duplicate(params.id);
      setLocation(`/design-studio/${copy.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project copy could not be created.");
    }
  }

  async function reopenProject() {
    if (!params.id) return;
    try {
      const reopened = await designStudioApi.reopen(params.id);
      setProject(reopened);
      setDirty(false);
      setActionMessage("Project reopened as an editable draft.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project could not be reopened.");
    }
  }

  if (loading) return <div className="mx-auto grid max-w-6xl gap-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-[32rem] rounded-xl" /></div>;
  if (!project || !canvas || !activePage) return <div className="mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-destructive/10 p-6" role="alert" data-testid="status-editor-error"><p className="font-bold">This project is unavailable.</p><p className="mt-1 text-sm text-muted-foreground">{error ?? "It may have been removed or you may not have access."}</p><Link className="mt-4 inline-flex text-sm font-semibold text-primary underline" href="/design-studio">Return to Studio</Link></div>;

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link aria-label="Back to Design Studio" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted" data-testid="link-back-studio" href="/design-studio"><ArrowLeft className="h-4 w-4" /></Link>
          <div><p className="text-sm text-muted-foreground">Adventure Zone Studio</p><h1 className="text-2xl font-bold tracking-tight">{name || "Untitled design"}</h1></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" role="status" data-testid="status-sync">{saving ? "Saving…" : dirty ? "Pending sync" : saved ? "All changes saved" : "Saved version"}</span>
          <AlertDialog><AlertDialogTrigger asChild><Button data-testid="button-archive-project" size="sm" variant="ghost"><Trash2 className="mr-2 h-4 w-4" />Archive</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Archive this project?</AlertDialogTitle><AlertDialogDescription>It will leave your active designs, but historical outputs remain available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep project</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>Archive project</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
          <Button data-testid="button-duplicate-project" onClick={() => void copyProject()} size="sm" variant="outline"><Copy className="mr-2 h-4 w-4" />Duplicate</Button>
          {project.status === "archived" ? <Button data-testid="button-reopen-project" onClick={() => void reopenProject()} size="sm" variant="outline">Reopen</Button> : null}
          <Button data-testid="button-save-project" disabled={saving || !name.trim() || project.status === "archived" || project.status === "used" || project.status === "sent"} onClick={() => void save()}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : saved ? "Saved" : "Save"}</Button>
        </div>
      </header>
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert" data-testid="status-editor-error-detail">{error}</p> : null}
      {actionMessage ? <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" role="status" data-testid="status-output-action">{actionMessage}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_17rem]">
        <Card className="h-fit">
          <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Studio tools</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            <div className="grid grid-cols-3 gap-2">
              <Button aria-label="Add text" data-testid="button-add-text" onClick={() => addElement("text")} size="sm" variant="outline"><Type className="h-4 w-4" /></Button>
              <Button aria-label="Add image" data-testid="button-add-image" onClick={() => addElement("image")} size="sm" variant="outline"><Image className="h-4 w-4" /></Button>
              <Button aria-label="Add shape" data-testid="button-add-shape" onClick={() => addElement("shape")} size="sm" variant="outline"><Square className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Button aria-label="Undo" disabled={!history.length} onClick={undo} size="sm" variant="outline"><Undo2 className="mr-1 h-4 w-4" />Undo</Button>
              <Button aria-label="Redo" disabled={!future.length} onClick={redo} size="sm" variant="outline"><Redo2 className="mr-1 h-4 w-4" />Redo</Button>
            </div>
            <div className="mt-2 border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Pages</p>
              <div className="grid gap-1">{canvas.pages.map((page, index) => <button className={`rounded-md px-3 py-2 text-left text-sm ${page.id === activePage.id ? "bg-secondary font-semibold" : "hover:bg-muted"}`} key={page.id} onClick={() => { setCanvas({ ...canvas, activePageId: page.id }); setSelectedId(null); }} type="button">Page {index + 1}<span className="ml-2 text-xs text-muted-foreground">{page.elements.length} layers</span></button>)}</div>
              <Button className="mt-2 w-full" onClick={() => setCanvas({ ...canvas, activePageId: `page-${canvas.pages.length + 1}`, pages: [...canvas.pages, { id: `page-${canvas.pages.length + 1}`, name: `Page ${canvas.pages.length + 1}`, background: "#fffaf4", elements: [] }] })} size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />New page</Button>
            </div>
            <div className="mt-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">Tip: select a layer, then use the inspector to adjust position, rotation, opacity, and lock state.</div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border py-3"><CardTitle className="flex items-center gap-2 text-sm"><FilePenLine className="h-4 w-4 text-primary" />{isDocument(type) ? "Document builder" : "Creative canvas"}<Badge variant="secondary">{type}</Badge></CardTitle><span className="text-xs text-muted-foreground">Page {canvas.pages.findIndex((page) => page.id === activePage.id) + 1} · {activePage.elements.length} layers</span></CardHeader>
          <CardContent className="grid gap-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
              <Button onClick={() => void prepareOutput("preview")} size="sm" variant="outline">Preview</Button>
              <Button onClick={() => void prepareOutput("export")} size="sm" variant="outline">Prepare export</Button>
              {type === "email" ? <Button onClick={() => void prepareOutput("gmail_draft")} size="sm" variant="outline">Create Gmail draft</Button> : null}
              {type === "review request" ? <Button onClick={() => void prepareOutput("review_request")} size="sm" variant="outline">Prepare review request</Button> : null}
              {type === "contract" ? <Button onClick={() => void prepareOutput("contract")} size="sm" variant="outline">Prepare signing packet</Button> : null}
            </div>
            {isDocument(type) ? (
              <div className="grid gap-3">
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">Structured blocks stay responsive in email and print previews. Protected brand and legal blocks cannot be changed by repurpose or AI suggestions.</div>
                {blockNames.map((block, index) => <div className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${index === blockNames.length - 1 ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`} key={block}><div><p className="font-semibold">{block}</p><p className="text-xs text-muted-foreground">{index === blockNames.length - 1 ? "Locked brand and legal content" : index === 1 ? "Live event and package fields available" : "Responsive content block"}</p></div><Badge variant={index === blockNames.length - 1 ? "secondary" : "outline"}>{index === blockNames.length - 1 ? "Protected" : "Editable"}</Badge></div>)}</div>
            ) : (
              <div className="relative mx-auto aspect-[4/3] w-full max-w-2xl overflow-hidden rounded-xl border border-border shadow-inner" style={{ backgroundColor: activePage.background }}>
                {activePage.elements.map((element) => <button aria-label={`Select ${element.label}`} className={`absolute flex items-center justify-center overflow-hidden rounded-md border-2 text-xs font-semibold transition ${selectedId === element.id ? "border-primary ring-2 ring-primary/25" : "border-transparent hover:border-primary/50"} ${element.kind === "image" ? "bg-secondary text-secondary-foreground" : ""}`} key={element.id} onClick={() => setSelectedId(element.id)} style={{ left: `${element.x}%`, top: `${element.y}%`, width: `${element.width}%`, height: `${element.height}%`, opacity: element.opacity, transform: `rotate(${element.rotation}deg)`, backgroundColor: element.kind === "shape" ? element.color : undefined, color: element.kind === "text" ? element.color : undefined }} type="button">{element.kind === "text" ? element.text : element.kind === "image" ? <><Image className="mr-1 h-4 w-4" />{element.label}</> : null}{element.locked ? <Lock className="absolute right-1 top-1 h-3 w-3" /> : null}</button>)}
                {!activePage.elements.length ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Choose a tool to add your first layer.</div> : null}
              </div>
            )}
            <div className="grid gap-2 border-t border-border pt-4">
              <Label htmlFor="project-name">Project name</Label>
              <Input data-testid="input-project-name" id="project-name" onChange={(event) => { setName(event.target.value); setDirty(true); }} value={name} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-type">Format</Label>
              <Select onValueChange={(value) => { setType(value as DesignType); setDirty(true); }} value={type}><SelectTrigger data-testid="select-project-type" id="project-type"><SelectValue /></SelectTrigger><SelectContent>{DESIGN_TYPES.map((item) => <SelectItem key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="grid gap-2"><Label htmlFor="project-content">{isDocument(type) ? "Document copy" : "Working copy"}</Label><Textarea className="min-h-28 resize-y" data-testid="textarea-project-content" id="project-content" onChange={(event) => { setContent(event.target.value); setDirty(true); }} placeholder="Add the words, offer, or details this piece should carry." value={content} /></div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Inspector</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {selected ? <>
              <div><p className="font-semibold">{selected.label}</p><p className="text-xs capitalize text-muted-foreground">{selected.kind} layer</p></div>
              {selected.kind === "text" ? <div className="grid gap-2"><Label htmlFor="selected-text">Text</Label><Input id="selected-text" onChange={(event) => updateSelected({ text: event.target.value })} value={selected.text ?? ""} /></div> : null}
              <div className="grid gap-2"><Label htmlFor="selected-opacity">Transparency</Label><input aria-label="Transparency" className="w-full accent-primary" id="selected-opacity" max="1" min="0.1" onChange={(event) => updateSelected({ opacity: Number(event.target.value) })} step="0.1" type="range" value={selected.opacity} /><span className="text-xs text-muted-foreground">{Math.round(selected.opacity * 100)}% visible</span></div>
              <div className="grid grid-cols-2 gap-2">
                <Button aria-label="Move layer up" onClick={() => updateSelected({ y: Math.max(0, selected.y - 3) })} size="sm" variant="outline"><ArrowUp className="mr-1 h-4 w-4" />Up</Button>
                <Button aria-label="Move layer down" onClick={() => updateSelected({ y: Math.min(90, selected.y + 3) })} size="sm" variant="outline"><ArrowDown className="mr-1 h-4 w-4" />Down</Button>
                <Button aria-label="Move layer left" onClick={() => updateSelected({ x: Math.max(0, selected.x - 3) })} size="sm" variant="outline"><ArrowLeft className="mr-1 h-4 w-4" />Left</Button>
                <Button aria-label="Move layer right" onClick={() => updateSelected({ x: Math.min(90, selected.x + 3) })} size="sm" variant="outline"><ArrowUp className="mr-1 h-4 w-4 rotate-90" />Right</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => updateSelected({ rotation: selected.rotation + 15 })} size="sm" variant="outline"><RotateCw className="mr-1 h-4 w-4" />Rotate</Button>
                <Button onClick={() => updateSelected({ locked: !selected.locked })} size="sm" variant="outline">{selected.locked ? <Unlock className="mr-1 h-4 w-4" /> : <Lock className="mr-1 h-4 w-4" />}{selected.locked ? "Unlock" : "Lock"}</Button>
                <Button onClick={() => changeCanvas((current) => ({ ...current, pages: current.pages.map((page) => page.id !== current.activePageId ? page : { ...page, elements: [...page.elements, { ...selected, id: `${selected.kind}-${Date.now()}`, x: Math.min(88, selected.x + 4), y: Math.min(88, selected.y + 4) }] }) }))} size="sm" variant="outline"><Copy className="mr-1 h-4 w-4" />Duplicate</Button>
                <Button disabled={selected.locked} onClick={() => { changeCanvas((current) => ({ ...current, pages: current.pages.map((page) => page.id !== current.activePageId ? page : { ...page, elements: page.elements.filter((element) => element.id !== selected.id) }) })); setSelectedId(null); }} size="sm" variant="outline"><Minus className="mr-1 h-4 w-4" />Delete</Button>
              </div>
              <div className="border-t border-border pt-3"><p className="mb-2 text-xs font-semibold text-muted-foreground">Layer order</p><div className="grid gap-1">{[...activePage.elements].reverse().map((element) => <button className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${selectedId === element.id ? "bg-secondary font-semibold" : "hover:bg-muted"}`} key={element.id} onClick={() => setSelectedId(element.id)} type="button"><span className="flex items-center gap-1">{element.locked ? <Lock className="h-3 w-3" /> : null}{element.label}</span><span className="capitalize text-muted-foreground">{element.kind}</span></button>)}</div></div>
            </> : <p className="text-sm text-muted-foreground">Select a layer to adjust it. Locked brand and legal content stays protected.</p>}
            <div className="grid gap-2 border-t border-border pt-3"><Label htmlFor="project-notes">Production notes</Label><Textarea id="project-notes" onChange={(event) => { setNotes(event.target.value); setDirty(true); }} placeholder="Audience, deadline, links, or handoff notes." value={notes} /></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}