import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, Cloud, Eye,
  FileText, ImagePlus, LayoutTemplate, Mail, Monitor, MoreHorizontal, Move,
  PanelLeft, Plus, Search, Smartphone, Sparkles, Trash2, Type, WandSparkles,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Separator } from "@workspace/avz-crm/components/ui/separator";
import { Switch } from "@workspace/avz-crm/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/avz-crm/components/ui/tabs";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import {
  designStudioApi, isImageAsset, resolveImageSrc,
  type DesignAsset, type DesignProject,
} from "@/lib/design-studio-api";
import {
  createDefaultEmailDocument, normalizeEmailDocument, serializeEmailDocument,
  shouldAcknowledgeSave, type EmailBlock, type EmailBlockType, type EmailDocument,
} from "@/lib/design-studio/email-model";

const LOCAL_MEDIA = [
  { src: `${import.meta.env.BASE_URL}assets/gallery-action-arena.jpg`, name: "Action arena", alt: "Action arena" },
  { src: `${import.meta.env.BASE_URL}assets/branded-email-builder-rafting.jpg`, name: "Wyoming rafting", alt: "Wyoming rafting" },
  { src: `${import.meta.env.BASE_URL}assets/branded-email-builder-camp.jpg`, name: "Family camp", alt: "Family camp" },
];
const SMART_FIELDS = ["contactName", "eventName", "eventDates", "senderName"];
const ADDABLE: EmailBlockType[] = ["heading", "paragraph", "button", "hero", "divider", "spacer"];
const ICONS: Record<EmailBlockType, typeof Type> = {
  header: Mail, hero: ImagePlus, heading: Type, paragraph: FileText,
  button: LayoutTemplate, divider: MoreHorizontal, spacer: Move, footer: Mail,
};

type Props = {
  project: DesignProject;
  assets: DesignAsset[];
  onProjectChange: (project: DesignProject) => void;
};

function defaultBlock(type: EmailBlockType): EmailBlock {
  const id = `${type}-${Date.now().toString(36)}`;
  const content = type === "heading" ? "A new adventure awaits"
    : type === "paragraph" ? "Add your message here."
      : type === "button" ? "Learn more"
        : "";
  return {
    id, type, content, link: "", showOnMobile: true,
    label: type === "spacer" ? "Spacing block" : `New ${type} block`,
  };
}

function EmailArtwork({ document, imageSrc, mobile }: {
  document: EmailDocument; imageSrc: string | null; mobile: boolean;
}) {
  const kit = document.brandKit;
  return (
    <div
      className={`mx-auto overflow-hidden border border-border bg-background shadow-lg ${mobile ? "w-[285px]" : "w-[490px]"}`}
      data-testid="email-preview"
    >
      {document.blocks.map((block) => {
        if (mobile && !block.showOnMobile) return null;
        if (block.type === "header") return (
          <div className="flex items-center justify-between px-5 py-4 text-white" key={block.id} style={{ backgroundColor: kit.textColor }}>
            <div className="text-sm font-black tracking-tight">ADVENTURE <span style={{ color: kit.primaryColor }}>ZONE</span></div>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/70">Explore</span>
          </div>
        );
        if (block.type === "hero") return (
          <div className="relative h-44 overflow-hidden" key={block.id} style={{ backgroundColor: kit.primaryColor }}>
            {imageSrc ? <img alt={document.hero.alt} className="h-full w-full object-cover" data-testid="email-hero-image" src={imageSrc} /> : null}
          </div>
        );
        if (block.type === "heading") return <h2 className="mx-6 mt-5 px-4 py-3 text-xl font-black uppercase leading-tight" key={block.id} style={{ backgroundColor: kit.accentColor, color: kit.textColor }}>{block.content}</h2>;
        if (block.type === "paragraph") return <p className="whitespace-pre-line px-6 py-3 text-sm leading-6" key={block.id} style={{ color: kit.textColor }}>{block.content}</p>;
        if (block.type === "button") return <div className="px-6 py-3" key={block.id}><div className="px-4 py-2.5 text-center text-sm font-bold text-white" style={{ backgroundColor: kit.highContrastButtons ? kit.primaryColor : kit.textColor }}>{block.content}</div></div>;
        if (block.type === "divider") return <div className="px-6 py-3" key={block.id}><Separator /></div>;
        if (block.type === "spacer") return <div className="h-8" key={block.id} />;
        return <div className="space-y-1 px-6 py-5 text-center text-[10px] text-muted-foreground" key={block.id}>{block.content.split("\n").map((line) => <p key={line}>{line}</p>)}</div>;
      })}
    </div>
  );
}

export function BrandedEmailEditor({ project, assets, onProjectChange }: Props) {
  const canEdit = project.status !== "archived" && project.status !== "used" && project.status !== "sent";
  const [name, setName] = useState(project.name);
  const [document, setDocument] = useState(() => normalizeEmailDocument(project.content));
  const [selectedId, setSelectedId] = useState(() => normalizeEmailDocument(project.content).blocks[0]!.id);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showAdd, setShowAdd] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showAiConnect, setShowAiConnect] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(true);
  const [mediaSearch, setMediaSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const latest = useRef({ name: project.name, document: normalizeEmailDocument(project.content) });
  const selected = useMemo(() => document.blocks.find((block) => block.id === selectedId), [document.blocks, selectedId]);
  const imageSrc = resolveImageSrc(document.hero, assets);

  const markChanged = useCallback((nextDocument: EmailDocument, nextName = name) => {
    if (!canEdit) return;
    revision.current += 1;
    latest.current = { name: nextName, document: nextDocument };
    setDocument(nextDocument);
    setDirty(true);
    setSaved(false);
  }, [canEdit, name]);

  const save = useCallback(async (status?: "draft" | "ready") => {
    if (!canEdit || !latest.current.name.trim() || saving) return false;
    const savedRevision = revision.current;
    const snapshot = latest.current;
    setSaving(true);
    setError(null);
    try {
      const value = await designStudioApi.update(project.id, {
        name: snapshot.name.trim(),
        content: serializeEmailDocument(snapshot.document),
        ...(status || project.status === "ready"
          ? { status: status ?? "draft" }
          : {}),
      });
      onProjectChange(value);
      if (shouldAcknowledgeSave(savedRevision, revision.current)) {
        setDirty(false);
        setSaved(true);
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Email could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, onProjectChange, project.id, project.status, saving]);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!canEdit || !dirty || saving) return;
    const timer = window.setTimeout(() => void saveRef.current(), 1200);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, saving, name, document]);

  function patchSelected(patch: Partial<EmailBlock>) {
    markChanged({ ...document, blocks: document.blocks.map((block) => block.id === selectedId ? { ...block, ...patch } : block) });
  }

  function moveSelected(offset: number) {
    const index = document.blocks.findIndex((block) => block.id === selectedId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= document.blocks.length) return;
    const blocks = [...document.blocks];
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    markChanged({ ...document, blocks });
  }

  function removeSelected() {
    if (document.blocks.length <= 1) return;
    const blocks = document.blocks.filter((block) => block.id !== selectedId);
    setSelectedId(blocks[0]!.id);
    markChanged({ ...document, blocks });
  }

  const media = [
    ...LOCAL_MEDIA.map((item) => ({ ...item, assetId: null as string | null, meta: "Adventure Zone library" })),
    ...assets.filter(isImageAsset).flatMap((asset) => {
      const src = resolveImageSrc({ assetId: asset.id, src: null }, assets);
      return src ? [{ src, assetId: asset.id, name: asset.name, alt: asset.altText ?? asset.name, meta: `${asset.scope} asset` }] : [];
    }),
  ].filter((item) => item.name.toLowerCase().includes(mediaSearch.toLowerCase()));

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-muted/30 text-foreground" data-testid="branded-email-editor">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild aria-label="Back to Design Studio" size="icon" variant="outline"><Link href="/design-studio"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <Separator className="hidden h-7 sm:block" orientation="vertical" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Input aria-label="Email project name" className="h-8 w-56 border-0 bg-transparent px-0 text-sm font-bold shadow-none focus-visible:ring-0 sm:w-72" disabled={!canEdit} onChange={(event) => { setName(event.target.value); markChanged(document, event.target.value); }} value={name} />
              <Badge variant="outline">Email</Badge>
            </div>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{saved ? <Check className="h-3 w-3 text-primary" /> : <Cloud className="h-3 w-3" />}{saving ? "Saving…" : saved ? "Saved" : "Unsaved changes"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="gap-2" disabled={!canEdit || saving || !dirty} onClick={() => void save()} size="sm" variant="outline"><Cloud className="h-3.5 w-3.5" />Save</Button>
          <Button className="gap-2" disabled={!canEdit} onClick={() => setShowReview(true)} size="sm"><Eye className="h-3.5 w-3.5" />Review</Button>
        </div>
      </header>
      {error ? <div className="m-3 border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div> : null}

      <div className="flex min-h-[calc(100vh-130px)] flex-col lg:flex-row">
        <aside className="w-full border-b border-border bg-card lg:w-72 lg:border-b-0 lg:border-r">
          <Tabs defaultValue="content">
            <TabsList className="grid w-full grid-cols-4 rounded-none border-b bg-transparent">
              <TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="brand">Brand Kit</TabsTrigger><TabsTrigger value="versions">Versions</TabsTrigger>
            </TabsList>
            <TabsContent className="mt-0 p-4" value="content">
              <div className="mb-4 flex items-start justify-between"><div><p className="text-sm font-bold">Email structure</p><p className="text-xs text-muted-foreground">{document.blocks.length} ordered blocks</p></div><Button aria-label="Add content block" disabled={!canEdit} onClick={() => setShowAdd(!showAdd)} size="icon" variant="outline"><Plus className="h-4 w-4" /></Button></div>
              {showAdd ? <div className="mb-3 grid grid-cols-2 gap-1 border border-border bg-muted/30 p-2">{ADDABLE.map((type) => <Button className="justify-start text-xs capitalize" disabled={!canEdit} key={type} onClick={() => { const block = defaultBlock(type); setSelectedId(block.id); markChanged({ ...document, blocks: [...document.blocks, block] }); setShowAdd(false); }} size="sm" variant="ghost">{type}</Button>)}</div> : null}
              <div className="space-y-1">{document.blocks.map((block) => { const Icon = ICONS[block.type]; return <Button className={`h-auto w-full justify-start gap-2 border px-2 py-2 text-left ${selectedId === block.id ? "border-primary bg-primary/5" : "border-transparent"}`} key={block.id} onClick={() => setSelectedId(block.id)} variant="ghost"><Icon className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{block.label}</span><span className="block truncate text-[11px] text-muted-foreground">{block.content || block.type}</span></span></Button>; })}</div>
              <div className="mt-5 border-t border-border pt-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Smart fields</p><div className="flex flex-wrap gap-1.5">{SMART_FIELDS.map((field) => <Button className="h-6 px-2 text-[10px]" disabled={!canEdit || !selected} key={field} onClick={() => selected && patchSelected({ content: `${selected.content}{{${field}}}` })} size="sm" variant="secondary">{`{{${field}}}`}</Button>)}</div></div>
            </TabsContent>
            <TabsContent className="mt-0 space-y-4 p-4" value="media">
              <div><p className="text-sm font-bold">Picture library</p><p className="text-xs text-muted-foreground">Choose a hero from Studio assets.</p></div>
              <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search picture library" className="pl-8" onChange={(event) => setMediaSearch(event.target.value)} placeholder="Search photos" value={mediaSearch} /></div>
              <div className="grid grid-cols-2 gap-2">{media.map((item) => <Button aria-label={`Use ${item.name}`} className={`h-auto flex-col items-stretch gap-0 overflow-hidden p-0 text-left ${document.hero.assetId === item.assetId && document.hero.src === (item.assetId ? null : item.src) ? "ring-2 ring-primary" : ""}`} disabled={!canEdit} key={`${item.assetId ?? "local"}-${item.src}`} onClick={() => markChanged({ ...document, hero: { assetId: item.assetId, src: item.assetId ? null : item.src, alt: item.alt, name: item.name } })} variant="outline"><img alt={item.alt} className="h-20 w-full object-cover" src={item.src} /><span className="px-2 py-1"><span className="block truncate text-xs font-semibold">{item.name}</span><span className="block truncate text-[10px] text-muted-foreground">{item.meta}</span></span></Button>)}</div>
            </TabsContent>
            <TabsContent className="mt-0 space-y-4 p-4" value="brand">
              <div><p className="text-sm font-bold">Adventure Zone kit</p><p className="text-xs text-muted-foreground">Applied to this email</p></div>
              <div className="flex items-center gap-3 border border-border bg-background p-3"><div className="flex h-9 w-9 items-center justify-center bg-foreground text-[8px] font-black text-background">AZ</div><span className="text-sm font-semibold">{document.brandKit.name}</span><Check className="ml-auto h-4 w-4 text-primary" /></div>
              {(["primaryColor", "accentColor", "textColor", "backgroundColor"] as const).map((key) => <div className="space-y-1" key={key}><Label className="capitalize" htmlFor={key}>{key.replace("Color", " color")}</Label><Input disabled={!canEdit} id={key} onChange={(event) => markChanged({ ...document, brandKit: { ...document.brandKit, [key]: event.target.value } })} type="color" value={document.brandKit[key]} /></div>)}
              <Label>Typography</Label><p className="text-sm">{document.brandKit.typography}</p>
              <div className="flex items-center justify-between text-sm"><span>High contrast buttons</span><Switch checked={document.brandKit.highContrastButtons} disabled={!canEdit} onCheckedChange={(checked) => markChanged({ ...document, brandKit: { ...document.brandKit, highContrastButtons: checked } })} /></div>
            </TabsContent>
            <TabsContent className="mt-0 space-y-3 p-4" value="versions"><p className="text-sm font-bold">Saved version</p><div className="flex items-center justify-between border border-border bg-background p-3 text-sm"><span>Current project version</span><Badge variant="outline">{dirty ? "Unsaved edits" : "Saved"}</Badge></div><p className="text-xs text-muted-foreground">Design Studio keeps the current persisted version. Version history is not yet available.</p></TabsContent>
          </Tabs>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3"><div className="flex items-center gap-2 text-sm"><PanelLeft className="h-4 w-4 text-muted-foreground" /><span className="font-semibold">Canvas</span><span className="text-muted-foreground">/</span><span className="text-muted-foreground">{selected?.label ?? "Select a block"}</span></div><div className="flex items-center gap-1 border border-border bg-card p-1"><Button onClick={() => setDevice("desktop")} size="sm" variant={device === "desktop" ? "secondary" : "ghost"}><Monitor className="mr-1 h-3.5 w-3.5" />Desktop</Button><Button onClick={() => setDevice("mobile")} size="sm" variant={device === "mobile" ? "secondary" : "ghost"}><Smartphone className="mr-1 h-3.5 w-3.5" />Mobile</Button></div></div>
          <div className="flex min-h-[620px] items-start justify-center bg-muted/50 p-6" style={{ backgroundColor: document.brandKit.backgroundColor }}><EmailArtwork document={document} imageSrc={imageSrc} mobile={device === "mobile"} /></div>
        </main>

        <aside className="w-full border-t border-border bg-card lg:w-80 lg:border-l lg:border-t-0">
          <div className="border-b border-border px-4 py-3"><p className="text-sm font-bold">Block settings</p><p className="text-xs text-muted-foreground">{selected?.label ?? "Nothing selected"}</p></div>
          {selected ? <div className="space-y-4 p-4"><div className="space-y-2"><Label htmlFor="email-content">Content</Label><Textarea disabled={!canEdit} id="email-content" onChange={(event) => patchSelected({ content: event.target.value })} value={selected.content} /></div><div className="space-y-2"><Label htmlFor="email-link">Link destination</Label><Input disabled={!canEdit} id="email-link" onChange={(event) => patchSelected({ link: event.target.value })} value={selected.link} /></div><div className="flex items-center justify-between border-t border-border pt-4"><div><p className="text-sm font-semibold">Show on mobile</p><p className="text-xs text-muted-foreground">Keep this block responsive</p></div><Switch checked={selected.showOnMobile} disabled={!canEdit} onCheckedChange={(checked) => patchSelected({ showOnMobile: checked })} /></div><div className="grid grid-cols-2 gap-2"><Button disabled={!canEdit} onClick={() => moveSelected(-1)} variant="outline"><ArrowUp className="mr-1 h-4 w-4" />Move up</Button><Button disabled={!canEdit} onClick={() => moveSelected(1)} variant="outline"><ArrowDown className="mr-1 h-4 w-4" />Move down</Button></div><Button className="w-full" disabled={!canEdit} onClick={removeSelected} variant="outline"><Trash2 className="mr-2 h-4 w-4" />Remove block</Button></div> : null}
          <div className="m-4 border border-primary/20 bg-primary/5 p-3"><div className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 text-primary" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><p className="text-xs font-bold">Smart content is ready</p><Button aria-label="Toggle AI helper" onClick={() => setAiExpanded(!aiExpanded)} size="icon" variant="ghost">{aiExpanded ? <ChevronDown className="h-4 w-4" /> : <WandSparkles className="h-4 w-4" />}</Button></div><p className="mt-1 text-xs text-muted-foreground">Personalize with approved smart fields.</p>{aiExpanded ? <div className="mt-3 space-y-2 border-t border-primary/10 pt-3"><div className="flex items-center gap-1.5 text-[11px] font-semibold"><Bot className="h-3.5 w-3.5" />AI helper<Button className="ml-auto h-6 px-2 text-[9px]" onClick={() => setShowAiConnect(true)} size="sm" variant="secondary">Connection info</Button></div><Textarea disabled placeholder="Ask for a subject line, rewrite, or CTA…" /><div className="flex gap-2"><Button disabled size="sm" variant="outline">Subject lines</Button><Button disabled size="sm" variant="outline">Improve copy</Button></div><p className="text-[10px] text-muted-foreground">Available after a workspace AI provider is configured securely server-side.</p></div> : null}</div></div></div>
        </aside>
      </div>

      <Dialog open={showAiConnect} onOpenChange={setShowAiConnect}><DialogContent><DialogHeader><DialogTitle>Connect your AI helper</DialogTitle><DialogDescription>An administrator must connect an approved provider securely on the server. API keys and provider secrets are never collected or stored in this browser.</DialogDescription></DialogHeader><div className="border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">Once configured, the helper can receive the selected block, approved brand rules, and your prompt. Recipient data remains excluded.</div><DialogFooter><Button onClick={() => setShowAiConnect(false)}>Got it</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={showReview} onOpenChange={setShowReview}><DialogContent><DialogHeader><DialogTitle>Review this email version</DialogTitle><DialogDescription>Confirm the draft is prepared for publishing. This does not create a campaign template or deliver an email.</DialogDescription></DialogHeader><div className="space-y-3 border border-border p-4 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Project</span><strong>{name}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Content blocks</span><strong>{document.blocks.length}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Responsive check</span><span className="flex items-center gap-1 text-primary"><Check className="h-4 w-4" />Desktop + mobile</span></div></div><DialogFooter><Button onClick={() => setShowReview(false)} variant="outline">Keep editing</Button><Button disabled={saving} onClick={async () => { if (await save("ready")) setShowReview(false); }}>Mark ready for review</Button></DialogFooter><p className="text-center text-xs text-muted-foreground">Ready versions are prepared for a future publishing workflow; they are not published automatically.</p></DialogContent></Dialog>
      <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 border border-border bg-card px-3 py-2 text-xs shadow-lg"><span className="font-semibold">Review state</span><Badge variant={project.status === "ready" ? "default" : "outline"}>{project.status === "ready" ? "Ready for review" : "Draft"}</Badge></div>
    </div>
  );
}