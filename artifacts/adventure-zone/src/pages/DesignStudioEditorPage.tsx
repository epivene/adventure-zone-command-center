import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Cloud,
  Copy,
  FilePenLine,
  Monitor,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@workspace/avz-crm/components/ui/alert-dialog";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Separator } from "@workspace/avz-crm/components/ui/separator";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@workspace/avz-crm/components/ui/tooltip";
import { DESIGN_TYPES, designStudioApi, type DesignAsset, type DesignProject, type DesignType } from "@/lib/design-studio-api";
import { createEmptyPage, normalizeCanvas, type CanvasDocument } from "@/lib/design-studio/model";
import { useFreeformEditor } from "@/components/design-studio/use-freeform-editor";
import { FreeformCanvas } from "@/components/design-studio/FreeformCanvas";
import { FreeformToolbar } from "@/components/design-studio/FreeformToolbar";
import { InspectorPanel } from "@/components/design-studio/InspectorPanel";
import { LayersPanel } from "@/components/design-studio/LayersPanel";

const documentTypes = new Set<DesignType>(["email", "review request", "contract"]);
const blockNames = ["Header", "Event details", "Personalized message", "Call to action", "Protected footer"];

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
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  // The freeform canvas model. Replaced only when a new project loads so the
  // editor hook can reset its own history against a stable reference.
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showMobilePanel, setShowMobilePanel] = useState<"tools" | "inspector" | null>(null);
  const editRevision = useRef(0);

  // Latest committed canvas doc for saving without adding it to autosave deps.
  const latestCanvas = useRef<CanvasDocument | null>(null);

  const markDirty = useCallback(() => {
    editRevision.current += 1;
    setDirty(true);
    setSaved(false);
  }, []);

  const canEdit = project?.status !== "archived" && project?.status !== "used" && project?.status !== "sent";

  // The freeform editor drives the canvas doc; its onChange flags dirty state.
  const editor = useFreeformEditor(canvasDoc ?? emptyDoc(), {
    canEdit: Boolean(canEdit),
    onChange: useCallback(
      (doc: CanvasDocument) => {
        latestCanvas.current = doc;
        markDirty();
      },
      [markDirty],
    ),
  });

  useEffect(() => {
    if (!params.id) return;
    setLoading(true);
    Promise.all([designStudioApi.get(params.id), designStudioApi.listAssets().catch(() => [])])
      .then(([value, assetList]) => {
        setProject(value);
        setName(value.name);
        setType(value.type);
        setContent(value.content ?? "");
        setNotes(value.notes ?? "");
        setAssets(assetList);
        const doc = normalizeCanvas(value.canvas);
        latestCanvas.current = doc;
        setCanvasDoc(doc);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Project could not be loaded."))
      .finally(() => setLoading(false));
  }, [params.id]);

  const activeCanvas = editor.doc;

  async function save() {
    if (!params.id || !name.trim()) return;
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
        canvas: latestCanvas.current ?? activeCanvas,
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

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty || loading || saving) return;
    const timer = window.setTimeout(() => void saveRef.current(), 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, saving, content, notes, name, type]);

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

  const addPage = useCallback(() => {
    editor.commitDoc({
      ...editor.doc,
      pages: [...editor.doc.pages, createEmptyPage(`Page ${editor.doc.pages.length + 1}`)],
    });
  }, [editor]);

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

  if (!project || !canvasDoc) {
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

  const document = isDocument(type);
  const pageIndex = activeCanvas.pages.findIndex((p) => p.id === activeCanvas.activePageId);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex min-h-[100dvh] flex-col bg-background">

        {/* Top toolbar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-sidebar px-4 py-2.5 text-sidebar-foreground shadow-sm">
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
              <span className="text-xs uppercase tracking-widest text-sidebar-foreground/50">Studio</span>
              <span className="text-sidebar-foreground/30">/</span>
            </div>

            <input
              aria-label="Project name"
              className="min-w-0 max-w-[12rem] rounded-md border-0 bg-transparent px-1.5 py-1 text-sm font-bold text-sidebar-foreground placeholder-sidebar-foreground/40 ring-0 transition-all hover:bg-sidebar-accent/30 focus:bg-sidebar-accent/40 focus:outline-none focus:ring-1 focus:ring-sidebar-ring sm:max-w-xs"
              data-testid="input-project-name"
              onChange={(event) => { setName(event.target.value); markDirty(); }}
              placeholder="Untitled design"
              value={name}
              disabled={!canEdit}
            />

            <Badge variant="secondary" className="hidden shrink-0 capitalize sm:inline-flex">{type}</Badge>
          </div>

          <div className="hidden flex-1 justify-center sm:flex">
            <SyncStatus saving={saving} dirty={dirty} saved={saved} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-1 md:flex">
              {outputActions.map(({ label, key }) => (
                <Button key={key} onClick={() => void prepareOutput(key)} size="sm" variant="ghost" className="text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid={`button-output-${key}`}>
                  {label}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-1 md:hidden">
              <Button size="sm" variant="ghost" className="gap-1 text-sidebar-foreground/80 hover:bg-sidebar-accent" onClick={() => void prepareOutput("preview")}>
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
              className="gap-1.5 bg-primary text-primary-foreground shadow hover:bg-primary/90"
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

        {/* Notifications */}
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

        {/* Freeform toolbar (only for creative canvases) */}
        {!document ? (
          <div className="border-b border-border bg-card/80 px-4 py-2">
            <FreeformToolbar editor={editor} assets={assets} />
          </div>
        ) : null}

        {/* Workspace */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left panel: pages, layers, settings */}
          <aside
            className={`
              w-56 shrink-0 overflow-y-auto border-r border-border bg-card
              ${showMobilePanel === "tools" ? "fixed inset-y-0 left-0 z-40 w-64 shadow-xl" : "hidden lg:flex lg:flex-col"}
            `}
          >
            <div className="flex flex-col gap-0 p-3">
              {!document ? (
                <>
                  <div>
                    <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Pages</p>
                    <div className="grid gap-1">
                      {activeCanvas.pages.map((page, index) => (
                        <button
                          key={page.id}
                          className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                            page.id === activeCanvas.activePageId ? "bg-primary/10 font-semibold text-primary" : "text-foreground hover:bg-muted"
                          }`}
                          onClick={() => editor.setActivePage(page.id)}
                          type="button"
                          data-testid={`button-page-${page.id}`}
                        >
                          <span>Page {index + 1}</span>
                          <span className={`text-xs tabular-nums ${page.id === activeCanvas.activePageId ? "text-primary/70" : "text-muted-foreground"}`}>
                            {page.nodes.length}
                          </span>
                        </button>
                      ))}
                    </div>
                    <Button className="mt-2 w-full justify-start gap-1.5" onClick={addPage} size="sm" variant="outline" disabled={!canEdit} data-testid="button-add-page">
                      <Plus className="h-3.5 w-3.5" />
                      New page
                    </Button>
                  </div>

                  <Separator className="my-3" />

                  <div>
                    <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Layers</p>
                    <LayersPanel editor={editor} />
                  </div>

                  <Separator className="my-3" />
                </>
              ) : null}

              <div>
                <Label htmlFor="project-type" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Format</Label>
                <Select onValueChange={(value) => { setType(value as DesignType); markDirty(); }} value={type} disabled={!canEdit}>
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

              <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                {document
                  ? "Structured blocks stay responsive across email and print. Protected brand and legal blocks cannot be changed."
                  : "Drag to move, use the corner handles to resize, and the top handle to rotate. Arrow keys nudge; hold Shift for larger steps."}
              </div>
            </div>
          </aside>

          {/* Center */}
          <main className="relative flex flex-1 flex-col overflow-hidden">
            <div className="relative z-50 flex items-center justify-between border-b border-border bg-card/80 px-4 py-2">
              <div className="flex items-center gap-2">
                <FilePenLine className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">{document ? "Document builder" : "Design Studio canvas"}</span>
                {!document ? (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    Page {pageIndex + 1} of {activeCanvas.pages.length} · {editor.page.nodes.length} layer{editor.page.nodes.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 lg:hidden">
                <Button data-testid="button-mobile-layers" size="sm" variant={showMobilePanel === "tools" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setShowMobilePanel(showMobilePanel === "tools" ? null : "tools")}>
                  Layers
                </Button>
                <Button data-testid="button-mobile-inspector" size="sm" variant={showMobilePanel === "inspector" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setShowMobilePanel(showMobilePanel === "inspector" ? null : "inspector")}>
                  Inspector
                </Button>
              </div>
            </div>

            {/* Output actions row */}
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-background/50 px-4 py-2">
              {outputActions.map(({ label, key }) => (
                <Button key={key} onClick={() => void prepareOutput(key)} size="sm" variant="outline" className="h-7 shrink-0 text-xs" data-testid={`button-output-row-${key}`}>
                  {label}
                </Button>
              ))}
              {!canEdit && (
                <Badge variant="secondary" className="ml-2 text-xs capitalize">{project.status} — read only</Badge>
              )}
            </div>

            {document ? (
              <div className="flex flex-1 flex-col items-center overflow-auto bg-muted/40 p-6">
                <div className="w-full max-w-2xl">
                  <div className="mb-4 rounded-xl border border-border bg-card/80 p-3 text-sm text-muted-foreground">
                    Structured blocks stay responsive in email and print previews. Protected brand and legal blocks cannot be changed by repurpose or AI suggestions.
                  </div>
                  <div className="grid gap-3">
                    {blockNames.map((block, index) => (
                      <div
                        key={block}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors ${
                          index === blockNames.length - 1 ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:border-border/80"
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
              </div>
            ) : (
              <FreeformCanvas editor={editor} assets={assets} />
            )}
          </main>

          {/* Right panel: inspector + notes */}
          <aside
            className={`
              w-72 shrink-0 overflow-y-auto border-l border-border bg-card
              ${showMobilePanel === "inspector" ? "fixed inset-y-0 right-0 z-40 shadow-xl" : "hidden lg:flex lg:flex-col"}
            `}
          >
            <div className="flex flex-col gap-4 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Inspector</p>
              {document ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Structured documents are edited block by block. Use Document copy to change the words and Production notes for handoff details.
                </div>
              ) : (
                <InspectorPanel editor={editor} assets={assets} />
              )}

              <Separator />

              <div className="grid gap-1.5">
                <Label htmlFor="project-notes" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Production notes</Label>
                <Textarea
                  id="project-notes"
                  data-testid="textarea-project-notes"
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

// Stable empty document reference used before the project's canvas loads. Kept
// module-level so the editor hook does not re-initialize on every render.
let cachedEmpty: CanvasDocument | null = null;
function emptyDoc(): CanvasDocument {
  if (!cachedEmpty) cachedEmpty = normalizeCanvas(null);
  return cachedEmpty;
}
