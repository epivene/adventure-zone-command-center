import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Check, Cloud, Eye, ImagePlus, PanelLeft, Search, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/avz-crm/components/ui/tabs";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { designStudioApi, isImageAsset, resolveImageSrc, type DesignAsset, type DesignProject } from "@/lib/design-studio-api";
import { createImageNode, getActivePage, type CanvasDocument } from "@/lib/design-studio/model";
import { shouldAcknowledgeSave } from "@/lib/design-studio/email-model";
import { useFreeformEditor } from "./use-freeform-editor";
import { FreeformCanvas } from "./FreeformCanvas";
import { InspectorPanel } from "./InspectorPanel";

type Props = {
  project: DesignProject;
  assets: DesignAsset[];
  canvas: CanvasDocument;
  onProjectChange: (project: DesignProject) => void;
  onCanvaAction?: () => void;
  canvaLabel?: string;
  canvaBusy?: boolean;
};
type VisualType = Exclude<DesignProject["type"], "email" | "contract">;

const CONFIG: Record<VisualType, { size: string; title: string; labels: string[] }> = {
  flyer: { size: "US Letter · portrait", title: "Poster layout", labels: ["Headline", "Date & time", "Location", "Ticket information", "Call to action"] },
  "social post": { size: "1080 × 1350 · portrait", title: "Social post", labels: ["Post headline", "Caption", "Event details", "Safe-area preview", "CTA"] },
  brochure: { size: "US Letter · one-sheet", title: "Print preview", labels: ["Package name", "Pricing", "Feature copy", "Content blocks", "Contact CTA"] },
  "review request": { size: "1080 × 1080 · square", title: "Review card", labels: ["Review message", "Rating", "QR code", "Review CTA", "Event name"] },
  blank: { size: "Flexible visual canvas", title: "Visual canvas", labels: ["Text", "Images", "Shapes", "Layout", "CTA"] },
};

const LOCAL_MEDIA = [
  { src: "/assets/gallery-action-arena.jpg", name: "Action arena", alt: "Action arena" },
  { src: "/assets/branded-email-builder-rafting.jpg", name: "Wyoming rafting", alt: "Wyoming rafting" },
  { src: "/assets/branded-email-builder-camp.jpg", name: "Family camp", alt: "Family camp" },
];

export function BrandedVisualEditor({ project, assets, canvas, onProjectChange, onCanvaAction, canvaLabel = "Canva", canvaBusy = false }: Props) {
  const type = (CONFIG[project.type as VisualType] ? project.type : "blank") as VisualType;
  const config = CONFIG[type];
  const canEdit = project.status !== "archived" && project.status !== "used" && project.status !== "sent";
  const [name, setName] = useState(project.name);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const revision = useRef(0);
  const latest = useRef(canvas);
  const editor = useFreeformEditor(canvas, {
    canEdit,
    onChange: (doc) => { latest.current = doc; revision.current += 1; setDirty(true); setSaved(false); },
  });
  const page = getActivePage(editor.doc);
  const media = useMemo(() => [
    ...LOCAL_MEDIA.map((item) => ({ ...item, assetId: null as string | null, meta: "Adventure Zone library" })),
    ...assets.filter(isImageAsset).flatMap((asset) => {
      const src = resolveImageSrc({ assetId: asset.id, src: null }, assets);
      return src ? [{ src, assetId: asset.id, name: asset.name, alt: asset.altText ?? asset.name, meta: `${asset.scope} asset` }] : [];
    }),
  ].filter((item) => item.name.toLowerCase().includes(search.toLowerCase())), [assets, search]);

  const save = useCallback(async (status?: "draft" | "ready") => {
    if (!canEdit || saving || !name.trim()) return false;
    const savedRevision = revision.current;
    setSaving(true); setError(null);
    try {
      const value = await designStudioApi.update(project.id, {
        name: name.trim(), type: project.type, canvas: latest.current,
        ...(status ? { status } : {}),
        syncState: "synced",
      });
      onProjectChange(value);
      if (shouldAcknowledgeSave(savedRevision, revision.current)) { setDirty(false); setSaved(true); }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Design could not be saved.");
      return false;
    } finally { setSaving(false); }
  }, [canEdit, name, onProjectChange, project.id, project.type, saving]);
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    if (!canEdit || !dirty || saving) return;
    const timer = window.setTimeout(() => void saveRef.current(), 1200);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, saving, name, editor.doc]);

  function chooseMedia(item: (typeof media)[number]) {
    editor.insertNode(createImageNode({
      name: item.name, alt: item.alt, assetId: item.assetId,
      src: item.assetId ? null : item.src,
      x: Math.max(24, editor.doc.width * 0.16), y: Math.max(24, editor.doc.height * 0.16),
      width: Math.min(420, editor.doc.width * 0.55), height: Math.min(300, editor.doc.height * 0.3),
    }));
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-muted/30 text-foreground" data-testid="branded-visual-editor">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild aria-label="Back to Design Studio" size="icon" variant="outline"><Link href="/design-studio"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div className="min-w-0"><div className="flex items-center gap-2"><Input aria-label="Visual project name" className="h-8 w-56 border-0 bg-transparent px-0 text-sm font-bold shadow-none focus-visible:ring-0" disabled={!canEdit} value={name} onChange={(e) => { setName(e.target.value); revision.current += 1; setDirty(true); setSaved(false); }} /><Badge variant="outline">{project.type}</Badge></div><p className="flex items-center gap-1 text-[11px] text-muted-foreground">{saved ? <Check className="h-3 w-3 text-primary" /> : <Cloud className="h-3 w-3" />}{saving ? "Saving…" : saved ? "Saved" : "Unsaved changes"}</p></div>
        </div>
        <div className="flex gap-2"><Button disabled={!canEdit || canvaBusy || !onCanvaAction} onClick={onCanvaAction} size="sm" variant="outline">{canvaLabel}</Button><Button disabled={!canEdit || saving || !dirty} onClick={() => void save()} size="sm" variant="outline"><Cloud className="mr-1 h-3.5 w-3.5" />Save</Button><Button disabled={!canEdit} onClick={() => setReviewOpen(true)} size="sm"><Eye className="mr-1 h-3.5 w-3.5" />Review</Button></div>
      </header>
      {error ? <div className="m-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div> : null}
      <div className="flex min-h-[calc(100vh-130px)] flex-col lg:flex-row">
        <aside className="w-full border-b border-border bg-card lg:w-72 lg:border-b-0 lg:border-r">
          <Tabs defaultValue="content">
            <TabsList className="grid w-full grid-cols-4 rounded-none border-b bg-transparent"><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="brand">Brand Kit</TabsTrigger><TabsTrigger value="versions">Versions</TabsTrigger></TabsList>
            <TabsContent className="mt-0 p-4" value="content"><p className="text-sm font-bold">{config.title}</p><p className="mb-3 text-xs text-muted-foreground">{config.size} · {page.nodes.length} ordered layers</p><div className="space-y-1">{page.nodes.map((node) => <Button className={`h-auto w-full justify-start gap-2 border px-2 py-2 text-left ${editor.selectedIds.includes(node.id) ? "border-primary bg-primary/5" : "border-transparent"}`} key={node.id} onClick={() => editor.select(node.id)} variant="ghost"><PanelLeft className="h-4 w-4 shrink-0 text-primary" /><span className="truncate text-sm font-semibold">{node.name}</span></Button>)}</div><div className="mt-5 border-t border-border pt-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Recommended layers</p>{config.labels.map((label) => <Badge className="mr-1 mb-1" key={label} variant="secondary">{label}</Badge>)}</div></TabsContent>
            <TabsContent className="mt-0 space-y-3 p-4" value="media"><p className="text-sm font-bold">Media library</p><p className="text-xs text-muted-foreground">Local Adventure Zone and Studio assets.</p><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search visual media" className="pl-8" onChange={(e) => setSearch(e.target.value)} placeholder="Search photos" value={search} /></div><div className="grid grid-cols-2 gap-2">{media.map((item) => <Button aria-label={`Add ${item.name}`} className="h-auto flex-col items-stretch gap-0 overflow-hidden p-0 text-left" disabled={!canEdit} key={`${item.assetId ?? "local"}-${item.src}`} onClick={() => chooseMedia(item)} variant="outline"><img alt={item.alt} className="h-20 w-full object-cover" src={item.src} /><span className="truncate px-2 py-1 text-xs font-semibold">{item.name}</span></Button>)}</div></TabsContent>
            <TabsContent className="space-y-3 p-4" value="brand"><p className="text-sm font-bold">Adventure Zone kit</p><p className="text-xs text-muted-foreground">Safe presentation controls for this document.</p><Label htmlFor="visual-background">Background color</Label><Input disabled={!canEdit} id="visual-background" type="color" value={page.background.startsWith("#") ? page.background : "#ffffff"} onChange={(e) => editor.commitDoc({ ...editor.doc, pages: editor.doc.pages.map((p) => p.id === editor.doc.activePageId ? { ...p, background: e.target.value } : p) })} /><p className="text-xs text-muted-foreground">Selected text and shape colors are available in layer settings.</p><Label htmlFor="visual-notes">Design notes</Label><Textarea disabled={!canEdit} id="visual-notes" placeholder="Add internal presentation notes…" /></TabsContent>
            <TabsContent className="space-y-3 p-4" value="versions"><p className="text-sm font-bold">Current persisted version</p><div className="flex justify-between border border-border bg-background p-3 text-sm"><span>Project version</span><Badge variant="outline">{dirty ? "Unsaved edits" : "Saved"}</Badge></div><p className="text-xs text-muted-foreground">Historical versions are not available; this reflects the current persisted project.</p></TabsContent>
          </Tabs>
        </aside>
        <main className="min-w-0 flex-1"><div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 text-sm"><span className="flex items-center gap-2 font-semibold"><PanelLeft className="h-4 w-4 text-muted-foreground" />{config.title}<span className="font-normal text-muted-foreground">/ {config.size}</span></span><Badge variant="secondary">{type === "social post" ? "Post-safe preview" : config.title}</Badge></div><div data-testid="design-canvas" className="flex min-h-[620px] items-start justify-center bg-muted/50 p-6"><FreeformCanvas assets={assets} editor={editor} /></div></main>
        <aside className="w-full border-t border-border bg-card p-4 lg:w-80 lg:border-l lg:border-t-0"><div className="mb-3 flex items-center gap-2 text-sm font-bold"><ImagePlus className="h-4 w-4 text-primary" />Layer settings</div><InspectorPanel assets={assets} editor={editor} /><div className="mt-4 border border-primary/20 bg-primary/5 p-3"><div className="flex items-center gap-2 text-xs font-bold"><Sparkles className="h-4 w-4 text-primary" />AI helper <Bot className="ml-auto h-4 w-4" /></div><p className="mt-1 text-xs text-muted-foreground">Provider configuration is handled securely server-side. No secrets or provider output are collected here.</p></div></aside>
      </div>
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent><DialogHeader><DialogTitle>Prepare this design for review</DialogTitle><DialogDescription>This saves the current visual design with status ready. It prepares the design for review and does not publish a campaign or template.</DialogDescription></DialogHeader><div className="border border-border p-4 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Format</span><strong>{config.size}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Layers</span><strong>{page.nodes.length}</strong></div></div><DialogFooter><Button onClick={() => setReviewOpen(false)} variant="outline">Keep editing</Button><Button disabled={saving} onClick={async () => { if (await save("ready")) setReviewOpen(false); }}>Mark ready for review</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}