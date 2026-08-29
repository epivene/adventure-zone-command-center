import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Cloud,
  Copy,
  FilePenLine,
  Image,
  Lock,
  Minus,
  Monitor,
  MoreHorizontal,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@workspace/avz-crm/components/ui/alert-dialog";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Separator } from "@workspace/avz-crm/components/ui/separator";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@workspace/avz-crm/components/ui/tooltip";
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
const colors = {
  text: "hsl(var(--foreground))",
  shape: "hsl(var(--primary))",
  image: "hsl(var(--secondary))",
};
const defaultPageBackground = "hsl(var(--card))";

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
    background: defaultPageBackground,
    elements: [newElement("text", 0)],
  }];
  return { activePageId: value?.activePageId ?? pages[0]!.id, pages: pages as StudioPage[] };
}

function isDocument(type: DesignType) {
  return documentTypes.has(type);
}

function SyncStatus({ saving, dirty, saved }: { saving: boolean; dirty: boolean; saved: boolean }) {
  if (saving) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" data-testid="status-sync">
        <Cloud className="h-3.5 w-3.5 animate-pulse text-primary" />
        Saving
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" data-testid="status-sync">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Unsaved changes
      </span>
    );
  }
  if (saved) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" data-testid="status-sync">
        <Check className="h-3.5 w-3.5 text-primary" />
        All changes saved
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground" role="status" data-testid="status-sync">
      Saved version
    </span>
  );
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
  const [zoom, setZoom] = useState(100);
  const [showMobilePanel, setShowMobilePanel] = useState<"tools" | "inspector" | null>(null);
  const editRevision = useRef(0);

  function markDirty() {
    editRevision.current += 1;
    setDirty(true);
    setSaved(false);
  }

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
    markDirty();
  }

  function updateSelected(change: Partial<StudioElement>) {
    if (!selected || (selected.locked && change.locked !== false)) return;
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
    markDirty();
  }

  function redo() {
    const next = future.at(-1);
    if (!canvas || !next) return;
    setHistory((items) => [...items, canvas]);
    setFuture((items) => items.slice(0, -1));
    setCanvas(next);
    markDirty();
  }

  async function save() {
    if (!params.id || !name.trim() || !canvas) return;
    const savingRevision = editRevision.current;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const value = await designStudioApi.update(params.id, {
        name: name.trim(),
        type,
        content,
        notes,
        canvas,
        syncState: "synced",
      });
      setProject(value);
      if (editRevision.current === savingRevision) {
        setDirty(false);
        setSaved(true);
      }
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
  }, [dirty, loading, saving, canvas, content, notes, name, type]);

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

  const canEdit = project?.status !== "archived" && project?.status !== "used" && project?.status !== "sent";

  const pageIndex = canvas ? canvas.pages.findIndex((p) => p.id === canvas.activePageId) : 0;

  // Zoom controls
  const zoomIn = () => setZoom((z) => Math.min(200, z + 25));
  const zoomOut = () => setZoom((z) => Math.max(25, z - 25));

  // Output action buttons derived from type
  const outputActions = useMemo(() => {
    const actions: Array<{ label: string; key: "preview" | "export" | "gmail_draft" | "review_request" | "contract" }> = [
      { label: "Preview", key: "preview" },
      { label: "Prepare export", key: "export" },
    ];
    if (type === "email") actions.push({ label: "Gmail draft", key: "gmail_draft" });
    if (type === "review request") actions.push({ label: "Review request", key: "review_request" });
    if (type === "contract") actions.push({ label: "Signing packet", key: "contract" });
    return actions;
  }, [type]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid flex-1 gap-4 lg:grid-cols-[15rem_1fr_17rem]">
          <Skeleton className="h-full min-h-64 rounded-xl" />
          <Skeleton className="h-full min-h-64 rounded-xl" />
          <Skeleton className="h-full min-h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!project || !canvas || !activePage) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center" role="alert" data-testid="status-editor-error">
        <p className="text-lg font-bold">This project is unavailable.</p>
        <p className="mt-2 text-sm text-muted-foreground">{error ?? "It may have been removed or you may not have access."}</p>
        <Link className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-muted" href="/design-studio">
          <ArrowLeft className="h-4 w-4" />
          Return to Studio
        </Link>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex min-h-[100dvh] flex-col bg-background">

        {/* Top toolbar — Canva-style sticky bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-sidebar px-4 py-2.5 text-sidebar-foreground shadow-sm">
          {/* Left: back + name */}
          <div className="flex min-w-0 items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  aria-label="Back to Design Studio"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-foreground transition-colors hover:bg-sidebar-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  data-testid="link-back-studio"
                  href="/design-studio"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent>Back to Studio</TooltipContent>
            </Tooltip>

            <div className="hidden items-center gap-1 sm:flex">
              <span className="text-xs text-sidebar-foreground/50 uppercase tracking-widest">Studio</span>
              <span className="text-sidebar-foreground/30">/</span>
            </div>

            <input
              aria-label="Project name"
              className="min-w-0 max-w-[12rem] rounded-md border-0 bg-transparent px-1.5 py-1 text-sm font-bold text-sidebar-foreground placeholder-sidebar-foreground/40 ring-0 transition-all hover:bg-sidebar-accent/30 focus:bg-sidebar-accent/40 focus:outline-none focus:ring-1 focus:ring-sidebar-ring sm:max-w-xs"
              data-testid="input-project-name"
              onChange={(event) => { setName(event.target.value); markDirty(); }}
              placeholder="Untitled design"
              value={name}
            />

            <Badge variant="secondary" className="hidden shrink-0 capitalize sm:inline-flex">{type}</Badge>
          </div>

          {/* Center: sync status */}
          <div className="hidden flex-1 justify-center sm:flex">
            <SyncStatus saving={saving} dirty={dirty} saved={saved} />
          </div>

          {/* Right: actions */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Output actions */}
            <div className="hidden items-center gap-1 md:flex">
              {outputActions.map(({ label, key }) => (
                <Button key={key} onClick={() => void prepareOutput(key)} size="sm" variant="ghost" className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground text-xs">
                  {label}
                </Button>
              ))}
            </div>

            {/* Mobile output toggle */}
            <div className="flex items-center gap-1 md:hidden">
              <Button size="sm" variant="ghost" className="text-sidebar-foreground/80 hover:bg-sidebar-accent gap-1" onClick={() => void prepareOutput("preview")}>
                <Monitor className="h-4 w-4" />
                <span className="hidden xs:inline">Preview</span>
              </Button>
            </div>

            <Separator orientation="vertical" className="hidden h-5 bg-sidebar-border md:block" />

            {project.status === "archived" ? (
              <Button data-testid="button-reopen-project" onClick={() => void reopenProject()} size="sm" variant="outline" className="border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80">
                Reopen
              </Button>
            ) : null}

            <Button
              aria-label="Duplicate project"
              data-testid="button-duplicate-project"
              onClick={() => void copyProject()}
              size="sm"
              variant="ghost"
              className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Copy className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Duplicate</span>
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  aria-label="Archive project"
                  data-testid="button-archive-project"
                  size="sm"
                  variant="ghost"
                  className="text-sidebar-foreground/60 hover:bg-destructive/20 hover:text-destructive-foreground"
                >
                  <Trash2 className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Archive</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this project?</AlertDialogTitle>
                  <AlertDialogDescription>It will leave your active designs, but historical outputs remain available.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep project</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void remove()}>Archive project</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              data-testid="button-save-project"
              disabled={saving || !name.trim() || !canEdit}
              onClick={() => void save()}
              size="sm"
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow"
            >
              {saving ? (
                <>
                  <Save className="h-4 w-4 animate-pulse" />
                  <span className="hidden sm:inline">Saving</span>
                </>
              ) : saved ? (
                <>
                  <Check className="h-4 w-4" />
                  <span className="hidden sm:inline">Saved</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span className="hidden sm:inline">Save</span>
                </>
              )}
            </Button>
          </div>
        </header>

        {/* Notification strip */}
        {(error || actionMessage) && (
          <div className="border-b border-border px-4 py-2">
            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="status-editor-error-detail">{error}</p>
            )}
            {actionMessage && (
              <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm" role="status" data-testid="status-output-action">{actionMessage}</p>
            )}
          </div>
        )}

        {/* Main 3-panel workspace */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left panel: tools + pages */}
          <aside
            className={`
              w-56 shrink-0 overflow-y-auto border-r border-border bg-card
              ${showMobilePanel === "tools" ? "fixed inset-y-0 left-0 z-40 w-64 shadow-xl" : "hidden lg:flex lg:flex-col"}
            `}
          >
            <div className="flex flex-col gap-0 p-3">
              {/* Add elements */}
              <div className="mb-1">
                <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Add element</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label="Add text"
                        data-testid="button-add-text"
                        onClick={() => addElement("text")}
                        size="sm"
                        variant="outline"
                        className="flex-col gap-1 h-auto py-2.5 hover:border-primary/50 hover:bg-primary/5"
                        disabled={!canEdit}
                      >
                        <Type className="h-4 w-4" />
                        <span className="text-[10px]">Text</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Add text layer</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label="Add image"
                        data-testid="button-add-image"
                        onClick={() => addElement("image")}
                        size="sm"
                        variant="outline"
                        className="flex-col gap-1 h-auto py-2.5 hover:border-primary/50 hover:bg-primary/5"
                        disabled={!canEdit}
                      >
                        <Image className="h-4 w-4" />
                        <span className="text-[10px]">Image</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Add image layer</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label="Add shape"
                        data-testid="button-add-shape"
                        onClick={() => addElement("shape")}
                        size="sm"
                        variant="outline"
                        className="flex-col gap-1 h-auto py-2.5 hover:border-primary/50 hover:bg-primary/5"
                        disabled={!canEdit}
                      >
                        <Square className="h-4 w-4" />
                        <span className="text-[10px]">Shape</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Add shape layer</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <Separator className="my-3" />

              {/* Undo/redo */}
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  aria-label="Undo"
                  disabled={!history.length}
                  onClick={undo}
                  size="sm"
                  variant="outline"
                  className="gap-1"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Undo
                </Button>
                <Button
                  aria-label="Redo"
                  disabled={!future.length}
                  onClick={redo}
                  size="sm"
                  variant="outline"
                  className="gap-1"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                  Redo
                </Button>
              </div>

              <Separator className="my-3" />

              {/* Pages */}
              <div>
                <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Pages</p>
                <div className="grid gap-1">
                  {canvas.pages.map((page, index) => (
                    <button
                      key={page.id}
                      className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                        page.id === activePage.id
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-foreground hover:bg-muted"
                      }`}
                      onClick={() => { setCanvas({ ...canvas, activePageId: page.id }); setSelectedId(null); }}
                      type="button"
                    >
                      <span>Page {index + 1}</span>
                      <span className={`text-xs tabular-nums ${page.id === activePage.id ? "text-primary/70" : "text-muted-foreground"}`}>
                        {page.elements.length}
                      </span>
                    </button>
                  ))}
                </div>
                <Button
                  className="mt-2 w-full justify-start gap-1.5"
                  onClick={() => changeCanvas((current) => {
                    const nextPageId = `page-${current.pages.length + 1}`;
                    return {
                      ...current,
                      activePageId: nextPageId,
                      pages: [...current.pages, {
                        id: nextPageId,
                        name: `Page ${current.pages.length + 1}`,
                        background: defaultPageBackground,
                        elements: [],
                      }],
                    };
                  })}
                  size="sm"
                  variant="outline"
                  disabled={!canEdit}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New page
                </Button>
              </div>

              <Separator className="my-3" />

              {/* Project settings */}
              <div className="grid gap-3">
                <div>
                  <Label htmlFor="project-type" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Format</Label>
                  <Select onValueChange={(value) => { setType(value as DesignType); markDirty(); }} value={type}>
                    <SelectTrigger data-testid="select-project-type" id="project-type" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DESIGN_TYPES.map((item) => (
                        <SelectItem key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground leading-relaxed">
                Select a layer, then use the inspector to adjust it. Locked content stays protected.
              </div>
            </div>
          </aside>

          {/* Center: canvas */}
          <main className="relative flex flex-1 flex-col overflow-hidden">
            {/* Canvas toolbar */}
            <div className="flex items-center justify-between border-b border-border bg-card/80 px-4 py-2">
              <div className="flex items-center gap-2">
                <FilePenLine className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">
                  {isDocument(type) ? "Document builder" : "Creative canvas"}
                </span>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Page {pageIndex + 1} of {canvas.pages.length} · {activePage.elements.length} layer{activePage.elements.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Zoom controls */}
                <div className="hidden items-center gap-1 sm:flex">
                  <Button size="sm" variant="ghost" onClick={zoomOut} className="h-7 w-7 p-0" aria-label="Zoom out">
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{zoom}%</span>
                  <Button size="sm" variant="ghost" onClick={zoomIn} className="h-7 w-7 p-0" aria-label="Zoom in">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Mobile panel toggles */}
                <div className="flex gap-1 lg:hidden">
                  <Button
                    size="sm"
                    variant={showMobilePanel === "tools" ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setShowMobilePanel(showMobilePanel === "tools" ? null : "tools")}
                  >
                    Tools
                  </Button>
                  <Button
                    size="sm"
                    variant={showMobilePanel === "inspector" ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setShowMobilePanel(showMobilePanel === "inspector" ? null : "inspector")}
                  >
                    Inspector
                  </Button>
                </div>
              </div>
            </div>

            {/* Output action row */}
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-background/50 px-4 py-2">
              {outputActions.map(({ label, key }) => (
                <Button key={key} onClick={() => void prepareOutput(key)} size="sm" variant="outline" className="shrink-0 text-xs h-7">
                  {label}
                </Button>
              ))}
              {!canEdit && (
                <Badge variant="secondary" className="ml-2 text-xs capitalize">{project.status} — read only</Badge>
              )}
            </div>

            {/* The canvas itself */}
            <div className="relative flex flex-1 flex-col items-center justify-start overflow-auto bg-muted/40 p-6">
              {isDocument(type) ? (
                <div className="w-full max-w-2xl">
                  <div className="mb-4 rounded-xl border border-border bg-card/80 p-3 text-sm text-muted-foreground">
                    Structured blocks stay responsive in email and print previews. Protected brand and legal blocks cannot be changed by repurpose or AI suggestions.
                  </div>
                  <div className="grid gap-3">
                    {blockNames.map((block, index) => (
                      <div
                        key={block}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors ${
                          index === blockNames.length - 1
                            ? "border-primary/30 bg-primary/5"
                            : "border-border bg-card hover:border-border/80"
                        }`}
                      >
                        <div>
                          <p className="font-bold">{block}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {index === blockNames.length - 1
                              ? "Locked brand and legal content"
                              : index === 1
                              ? "Live event and package fields available"
                              : "Responsive content block"}
                          </p>
                        </div>
                        <Badge variant={index === blockNames.length - 1 ? "secondary" : "outline"}>
                          {index === blockNames.length - 1 ? "Protected" : "Editable"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {/* Working copy area */}
                  <div className="mt-5 grid gap-2">
                    <Label htmlFor="project-content" className="font-bold">Document copy</Label>
                    <Textarea
                      className="min-h-28 resize-y"
                      data-testid="textarea-project-content"
                      id="project-content"
                      onChange={(event) => { setContent(event.target.value); markDirty(); }}
                      placeholder="Add the words, offer, or details this piece should carry."
                      value={content}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-3xl">
                  {/* Canvas frame */}
                  <div
                    className="relative mx-auto overflow-hidden rounded-2xl border-2 border-border shadow-2xl transition-all"
                    style={{
                      backgroundColor: activePage.background,
                      aspectRatio: "4/3",
                      transform: `scale(${zoom / 100})`,
                      transformOrigin: "top center",
                    }}
                  >
                    {activePage.elements.map((element) => (
                      <button
                        key={element.id}
                        aria-label={`Select ${element.label}`}
                        className={`absolute flex items-center justify-center overflow-hidden rounded-lg border-2 text-xs font-semibold transition-all duration-100 ${
                          selectedId === element.id
                            ? "border-primary shadow-lg ring-2 ring-primary/30 ring-offset-1"
                            : "border-transparent hover:border-primary/50 hover:shadow-md"
                        } ${element.kind === "image" ? "bg-secondary/80 text-secondary-foreground" : ""}`}
                        onClick={() => setSelectedId(element.id)}
                        style={{
                          left: `${element.x}%`,
                          top: `${element.y}%`,
                          width: `${element.width}%`,
                          height: `${element.height}%`,
                          opacity: element.opacity,
                          transform: `rotate(${element.rotation}deg)`,
                          backgroundColor: element.kind === "shape" ? element.color : undefined,
                          color: element.kind === "text" ? element.color : undefined,
                        }}
                        type="button"
                      >
                        {element.kind === "text" ? (
                          <span className="px-2 text-center leading-tight">{element.text}</span>
                        ) : element.kind === "image" ? (
                          <span className="flex flex-col items-center gap-1">
                            <Image className="h-5 w-5 opacity-60" />
                            <span className="text-[10px] opacity-70">{element.label}</span>
                          </span>
                        ) : null}
                        {element.locked ? (
                          <Lock className="absolute right-1.5 top-1.5 h-3 w-3 opacity-60" />
                        ) : null}
                      </button>
                    ))}
                    {!activePage.elements.length ? (
                      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/30 bg-muted/30">
                          <Plus className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm text-muted-foreground">Choose a tool to add your first layer.</p>
                      </div>
                    ) : null}
                  </div>

                  {/* Working copy below canvas */}
                  <div className="mt-6 grid gap-3">
                    <div>
                      <Label htmlFor="project-content" className="font-bold">Working copy</Label>
                      <Textarea
                        className="mt-1.5 min-h-20 resize-y"
                        data-testid="textarea-project-content"
                        id="project-content"
                        onChange={(event) => { setContent(event.target.value); markDirty(); }}
                        placeholder="Add the words, offer, or details this piece should carry."
                        value={content}
                        disabled={!canEdit}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Right panel: inspector */}
          <aside
            className={`
              w-64 shrink-0 overflow-y-auto border-l border-border bg-card
              ${showMobilePanel === "inspector" ? "fixed inset-y-0 right-0 z-40 shadow-xl" : "hidden lg:flex lg:flex-col"}
            `}
          >
            <div className="flex flex-col gap-4 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Inspector</p>

              {selected ? (
                <>
                  {/* Selected element header */}
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="font-bold leading-tight">{selected.label}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">{selected.kind} layer</p>
                  </div>

                  {/* Text content */}
                  {selected.kind === "text" ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor="selected-text" className="text-xs font-semibold">Text content</Label>
                      <Input
                        id="selected-text"
                        onChange={(event) => updateSelected({ text: event.target.value })}
                        value={selected.text ?? ""}
                        disabled={selected.locked || !canEdit}
                        className="text-sm"
                      />
                    </div>
                  ) : null}

                  {/* Opacity */}
                  <div className="grid gap-1.5">
                    <Label htmlFor="selected-opacity" className="text-xs font-semibold">Opacity</Label>
                    <input
                      aria-label="Transparency"
                      className="w-full accent-primary"
                      id="selected-opacity"
                      max="1"
                      min="0.1"
                      onChange={(event) => updateSelected({ opacity: Number(event.target.value) })}
                      step="0.1"
                      type="range"
                      value={selected.opacity}
                      disabled={selected.locked || !canEdit}
                    />
                    <span className="text-xs text-muted-foreground">{Math.round(selected.opacity * 100)}% visible</span>
                  </div>

                  {/* Position controls */}
                  <div className="grid gap-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Position</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button aria-label="Move layer up" onClick={() => updateSelected({ y: Math.max(0, selected.y - 3) })} size="sm" variant="outline" disabled={selected.locked || !canEdit}>
                        <ArrowUp className="mr-1 h-3.5 w-3.5" />Up
                      </Button>
                      <Button aria-label="Move layer down" onClick={() => updateSelected({ y: Math.min(90, selected.y + 3) })} size="sm" variant="outline" disabled={selected.locked || !canEdit}>
                        <ArrowDown className="mr-1 h-3.5 w-3.5" />Down
                      </Button>
                      <Button aria-label="Move layer left" onClick={() => updateSelected({ x: Math.max(0, selected.x - 3) })} size="sm" variant="outline" disabled={selected.locked || !canEdit}>
                        <ArrowLeft className="mr-1 h-3.5 w-3.5" />Left
                      </Button>
                      <Button aria-label="Move layer right" onClick={() => updateSelected({ x: Math.min(90, selected.x + 3) })} size="sm" variant="outline" disabled={selected.locked || !canEdit}>
                        <ArrowUp className="mr-1 h-3.5 w-3.5 rotate-90" />Right
                      </Button>
                    </div>
                  </div>

                  {/* Transform */}
                  <div className="grid gap-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Transform</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button onClick={() => updateSelected({ rotation: selected.rotation + 15 })} size="sm" variant="outline" disabled={selected.locked || !canEdit}>
                        <RotateCw className="mr-1 h-3.5 w-3.5" />Rotate
                      </Button>
                      <Button onClick={() => updateSelected({ locked: !selected.locked })} size="sm" variant={selected.locked ? "default" : "outline"} disabled={!canEdit}>
                        {selected.locked ? <Unlock className="mr-1 h-3.5 w-3.5" /> : <Lock className="mr-1 h-3.5 w-3.5" />}
                        {selected.locked ? "Unlock" : "Lock"}
                      </Button>
                      <Button
                        onClick={() => changeCanvas((current) => ({
                          ...current,
                          pages: current.pages.map((page) => page.id !== current.activePageId ? page : {
                            ...page,
                            elements: [...page.elements, {
                              ...selected,
                              id: `${selected.kind}-${Date.now()}`,
                              x: Math.min(88, selected.x + 4),
                              y: Math.min(88, selected.y + 4),
                            }],
                          }),
                        }))}
                        size="sm"
                        variant="outline"
                        disabled={!canEdit}
                      >
                        <Copy className="mr-1 h-3.5 w-3.5" />Clone
                      </Button>
                      <Button
                        disabled={selected.locked || !canEdit}
                        onClick={() => {
                          changeCanvas((current) => ({
                            ...current,
                            pages: current.pages.map((page) => page.id !== current.activePageId ? page : {
                              ...page,
                              elements: page.elements.filter((element) => element.id !== selected.id),
                            }),
                          }));
                          setSelectedId(null);
                        }}
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Minus className="mr-1 h-3.5 w-3.5" />Delete
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  {/* Layer order */}
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">All layers</p>
                    <div className="grid gap-1">
                      {[...activePage.elements].reverse().map((element) => (
                        <button
                          key={element.id}
                          className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                            selectedId === element.id
                              ? "bg-primary/10 font-semibold text-primary"
                              : "hover:bg-muted text-foreground"
                          }`}
                          onClick={() => setSelectedId(element.id)}
                          type="button"
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            {element.locked ? <Lock className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
                            <span className="truncate">{element.label}</span>
                          </span>
                          <span className="ml-2 shrink-0 capitalize text-muted-foreground">{element.kind}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-8 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-snug px-2">
                    Select a layer to adjust it. Locked brand and legal content stays protected.
                  </p>
                </div>
              )}

              <Separator />

              {/* Production notes */}
              <div className="grid gap-1.5">
                <Label htmlFor="project-notes" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Production notes</Label>
                <Textarea
                  id="project-notes"
                  onChange={(event) => { setNotes(event.target.value); markDirty(); }}
                  placeholder="Audience, deadline, links, or handoff notes."
                  value={notes}
                  className="min-h-20 resize-y text-sm"
                  disabled={!canEdit}
                />
              </div>
            </div>
          </aside>
        </div>

        {/* Mobile overlay backdrop */}
        {showMobilePanel && (
          <div
            className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
            onClick={() => setShowMobilePanel(null)}
            aria-hidden="true"
          />
        )}
      </div>
    </TooltipProvider>
  );
}
