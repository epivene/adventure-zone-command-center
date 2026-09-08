import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Eye,
  FileText,
  ImagePlus,
  LayoutTemplate,
  Mail,
  Monitor,
  MoreHorizontal,
  Move,
  Palette,
  PanelLeft,
  Plus,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  Upload,
  WandSparkles,
  Undo2,
  Redo2,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Separator } from "@workspace/avz-crm/components/ui/separator";
import { Switch } from "@workspace/avz-crm/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/avz-crm/components/ui/tabs";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";

type BlockType = "header" | "hero" | "heading" | "paragraph" | "button" | "divider" | "spacer" | "footer";
type Block = { id: string; type: BlockType; label: string; summary: string };

const INITIAL_BLOCKS: Block[] = [
  { id: "header", type: "header", label: "Adventure Zone header", summary: "Logo, navigation, preference link" },
  { id: "hero", type: "hero", label: "Hero image", summary: "Wyoming summer group adventure" },
  { id: "heading", type: "heading", label: "Main heading", summary: "Your next adventure starts here" },
  { id: "paragraph", type: "paragraph", label: "Intro paragraph", summary: "Personalized welcome copy" },
  { id: "button", type: "button", label: "Primary call to action", summary: "Plan your visit" },
  { id: "divider", type: "divider", label: "Divider", summary: "Subtle section break" },
  { id: "footer", type: "footer", label: "Adventure Zone footer", summary: "Contact, social and unsubscribe" },
];

const EMAIL_IMAGE_OPTIONS = [
  { src: "/__mockup/images/adventure-zone-email-hero.jpg", alt: "Action arena", label: "Action arena", meta: "Existing library" },
  { src: "/__mockup/images/branded-email-builder-rafting.jpg", alt: "Wyoming rafting", label: "Wyoming rafting", meta: "Uploaded by Sarah" },
  { src: "/__mockup/images/branded-email-builder-camp.jpg", alt: "Family camp", label: "Family camp", meta: "Uploaded by Sarah" },
];

const BLOCK_ICONS: Record<BlockType, typeof Type> = {
  header: Mail,
  hero: ImagePlus,
  heading: Type,
  paragraph: FileText,
  button: LayoutTemplate,
  divider: MoreHorizontal,
  spacer: Move,
  footer: Mail,
};

function EmailArtwork({ mobile, imageSrc }: { mobile: boolean; imageSrc: string }) {
  return (
    <div className={`mx-auto overflow-hidden border border-border bg-background shadow-lg ${mobile ? "w-[285px]" : "w-[490px]"}`}>
      <div className="flex items-center justify-between bg-[#080808] px-5 py-4 text-white">
        <div className="text-sm font-black tracking-tight">ADVENTURE <span className="text-[#ff1791]">ZONE</span></div>
        <span className="text-[10px] uppercase tracking-[0.16em] text-white/70">Explore</span>
      </div>
      <div className="relative h-44 overflow-hidden bg-[#ff1791]">
        <img alt="Adventure Zone email hero" className="h-full w-full object-cover" src={imageSrc} />
        <div className="absolute inset-x-5 bottom-5 bg-[#ffd21c] px-4 py-3 text-xl font-black uppercase leading-none text-[#080808]">Your next adventure starts here</div>
      </div>
      <div className="space-y-4 bg-[#fff9f5] px-6 py-6">
        <p className="text-sm font-bold text-[#080808]">Hi {"{{contactName}}"},</p>
        <p className="text-sm leading-6 text-[#080808]">Big skies, bold stories, and unforgettable Wyoming moments are waiting. Join us for a day your group will talk about all year.</p>
        <div className="border-l-4 border-[#ff1791] bg-white px-4 py-3 text-xs text-[#080808]">
          <strong>{"{{eventName}}"}</strong><br />{"{{eventDates}}"} · Cody, Wyoming
        </div>
        <Button className="w-full" size="sm">Plan your visit</Button>
        <Separator />
        <div className="space-y-1 text-center text-[10px] text-muted-foreground">
          <p>Adventure Zone · Cody, Wyoming</p>
          <p>Manage preferences · Unsubscribe</p>
        </div>
      </div>
    </div>
  );
}

function BlockRow({ block, selected, onSelect, onDelete }: { block: Block; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const Icon = BLOCK_ICONS[block.type];
  return (
    <div className={`group flex items-center gap-2 border px-2 py-2 transition-colors ${selected ? "border-primary bg-primary/5" : "border-transparent hover:border-border"}`}>
      <Button aria-label={`Select ${block.label}`} className="min-w-0 flex-1 justify-start gap-2 text-left" onClick={onSelect} variant="ghost">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{block.label}</span><span className="block truncate text-[11px] text-muted-foreground">{block.summary}</span></span>
      </Button>
      {selected ? <Button aria-label={`Delete ${block.label}`} onClick={onDelete} size="icon" variant="ghost"><Trash2 className="h-3.5 w-3.5" /></Button> : null}
    </div>
  );
}

export function BrandedEmailBuilder() {
  const [projectName, setProjectName] = useState("Summer Adventure Welcome");
  const [blocks, setBlocks] = useState(INITIAL_BLOCKS);
  const [selectedId, setSelectedId] = useState("heading");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [saved, setSaved] = useState(true);
  const [publishState, setPublishState] = useState<"Draft" | "Needs review" | "Published">("Draft");
  const [showAdd, setShowAdd] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [activeImage, setActiveImage] = useState(EMAIL_IMAGE_OPTIONS[0].src);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaNotice, setMediaNotice] = useState("");
  const [aiExpanded, setAiExpanded] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiThinking, setAiThinking] = useState(false);
  const [showApiConnect, setShowApiConnect] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const selected = useMemo(() => blocks.find((block) => block.id === selectedId), [blocks, selectedId]);

  function markDirty() { setSaved(false); setPublishState("Draft"); }
  function addBlock(type: BlockType) {
    const id = `${type}-${Date.now()}`;
    const label = type === "spacer" ? "Spacing block" : `New ${type} block`;
    setBlocks((current) => [...current, { id, type, label, summary: "Click to edit content" }]);
    setSelectedId(id);
    setShowAdd(false);
    markDirty();
  }
  function removeBlock() {
    if (!selectedId || blocks.length <= 1) return;
    setBlocks((current) => current.filter((block) => block.id !== selectedId));
    setSelectedId(blocks.find((block) => block.id !== selectedId)?.id ?? "header");
    markDirty();
  }

  function runAiHelper(task = aiPrompt || "Make this welcome email feel more energetic and personal.") {
    setAiThinking(true);
    setAiSuggestion("");
    window.setTimeout(() => {
      setAiThinking(false);
      setAiSuggestion("Try: “Your next Wyoming adventure starts with one good day.” I can also tailor the CTA, subject line, or tone before you publish.");
    }, 550);
    setAiPrompt(task);
  }

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button aria-label="Back to Design Studio" size="icon" variant="outline"><ArrowLeft className="h-4 w-4" /></Button>
          <Separator className="hidden h-7 sm:block" orientation="vertical" />
          <div className="min-w-0">
            <div className="flex items-center gap-2"><Input aria-label="Email project name" className="h-8 w-56 border-0 bg-transparent px-0 text-sm font-bold shadow-none focus-visible:ring-0 sm:w-72" onChange={(event) => { setProjectName(event.target.value); markDirty(); }} value={projectName} /><Badge variant="outline">Email</Badge></div>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{saved ? <Check className="h-3 w-3 text-primary" /> : <Cloud className="h-3 w-3" />} {saved ? "Saved just now" : "Unsaved changes"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button aria-label="Undo" disabled size="icon" variant="ghost"><Undo2 className="h-4 w-4" /></Button>
          <Button aria-label="Redo" disabled size="icon" variant="ghost"><Redo2 className="h-4 w-4" /></Button>
          <Button className="gap-2" onClick={() => setSaved(true)} size="sm" variant="outline"><Cloud className="h-3.5 w-3.5" />Save</Button>
          <Button className="gap-2" onClick={() => setShowReview(true)} size="sm"><Eye className="h-3.5 w-3.5" />Review & publish</Button>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-65px)] flex-col lg:flex-row">
        <aside className="w-full border-b border-border bg-card lg:w-72 lg:border-b-0 lg:border-r">
          <Tabs defaultValue="content" className="w-full">
             <TabsList className="grid w-full grid-cols-4 rounded-none border-b bg-transparent">
               <TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="brand">Brand kit</TabsTrigger><TabsTrigger value="versions">Versions</TabsTrigger>
            </TabsList>
            <TabsContent className="mt-0 p-4" value="content">
              <div className="mb-4 flex items-start justify-between"><div><p className="text-sm font-bold">Email structure</p><p className="text-xs text-muted-foreground">{blocks.length} blocks · drag to reorder</p></div><Button aria-label="Add content block" onClick={() => setShowAdd(!showAdd)} size="icon" variant="outline"><Plus className="h-4 w-4" /></Button></div>
              {showAdd ? <div className="mb-3 grid grid-cols-2 gap-1 border border-border bg-muted/30 p-2">{(["heading", "paragraph", "button", "hero", "divider", "spacer"] as BlockType[]).map((type) => <Button key={type} className="justify-start text-xs capitalize" onClick={() => addBlock(type)} size="sm" variant="ghost">{type}</Button>)}</div> : null}
              <div className="space-y-1">{blocks.map((block) => <BlockRow block={block} key={block.id} onDelete={removeBlock} onSelect={() => setSelectedId(block.id)} selected={selectedId === block.id} />)}</div>
              <div className="mt-5 border-t border-border pt-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Smart fields</p><div className="flex flex-wrap gap-1.5">{["contactName", "eventName", "eventDates", "senderName"].map((field) => <Badge key={field} variant="secondary">{"{{"}{field}{"}}"}</Badge>)}</div></div>
            </TabsContent>
             <TabsContent className="mt-0 space-y-4 p-4" value="media">
               <div><p className="text-sm font-bold">Picture library</p><p className="text-xs text-muted-foreground">Choose a visual for the selected email block.</p></div>
               <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search picture library" className="pl-8" onChange={(event) => setMediaSearch(event.target.value)} placeholder="Search photos" value={mediaSearch} /></div>
               <div className="grid grid-cols-2 gap-2">
                 {EMAIL_IMAGE_OPTIONS.filter((image) => image.label.toLowerCase().includes(mediaSearch.toLowerCase())).map((image) => <Button aria-label={`Use ${image.label}`} className={`group h-auto flex-col items-stretch gap-0 overflow-hidden p-0 text-left ${activeImage === image.src ? "ring-2 ring-primary" : ""}`} key={image.src} onClick={() => { setActiveImage(image.src); setMediaNotice(`${image.label} applied to the hero block`); markDirty(); }} variant="outline"><img alt={image.alt} className="h-20 w-full object-cover" src={image.src} /><span className="px-2 pb-2 pt-1"><span className="block truncate text-xs font-semibold">{image.label}</span><span className="block truncate text-[10px] text-muted-foreground">{image.meta}</span></span></Button>)}
               </div>
               <div className="border border-dashed border-border bg-muted/20 p-3"><div className="flex items-start gap-2"><Upload className="mt-0.5 h-4 w-4 text-primary" /><div className="min-w-0"><p className="text-xs font-semibold">Bring in a new picture</p><p className="mt-1 text-[11px] text-muted-foreground">Upload a photo or ask your connected image API for a fresh option.</p><Button className="mt-2" onClick={() => setMediaNotice("Upload placeholder ready — connect your media API to finish this flow.")} size="sm" variant="outline"><Upload className="mr-1.5 h-3.5 w-3.5" />Upload image</Button></div></div></div>
               {mediaNotice ? <p className="text-[11px] text-primary">{mediaNotice}</p> : null}
             </TabsContent>
            <TabsContent className="mt-0 space-y-4 p-4" value="brand">
              <div><p className="text-sm font-bold">Adventure Zone kit</p><p className="text-xs text-muted-foreground">Applied to this email</p></div>
              <div className="flex items-center gap-3 border border-border bg-background p-3"><div className="flex h-9 w-9 items-center justify-center bg-[#080808] text-[8px] font-black text-white">AZ</div><span className="text-sm font-semibold">Adventure Zone</span><Check className="ml-auto h-4 w-4 text-primary" /></div>
              <div className="space-y-3"><Label>Brand colors</Label><div className="flex gap-2"><span className="h-8 w-8 bg-[#ff1791]" /><span className="h-8 w-8 bg-[#ffd21c]" /><span className="h-8 w-8 bg-[#080808]" /><span className="h-8 w-8 bg-[#fff9f5] ring-1 ring-border" /></div><Label>Typography</Label><p className="text-sm">DM Sans / Impact display</p><Label>Button style</Label><div className="flex items-center justify-between text-sm"><span>High contrast</span><Switch checked /></div></div>
            </TabsContent>
            <TabsContent className="mt-0 space-y-3 p-4" value="versions"><p className="text-sm font-bold">Saved versions</p>{["Version 3 · Current", "Version 2 · Aug 18", "Version 1 · Aug 12"].map((version, index) => <Button className="w-full justify-between" key={version} variant={index === 0 ? "secondary" : "ghost"}><span>{version}</span>{index === 0 ? <Badge variant="outline">Live draft</Badge> : null}</Button>)}</TabsContent>
          </Tabs>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-sm"><PanelLeft className="h-4 w-4 text-muted-foreground" /><span className="font-semibold">Canvas</span><span className="text-muted-foreground">/</span><span className="text-muted-foreground">{selected?.label ?? "Select a block"}</span></div>
            <div className="flex items-center gap-1 border border-border bg-card p-1"><Button aria-label="Desktop preview" onClick={() => setDevice("desktop")} size="sm" variant={device === "desktop" ? "secondary" : "ghost"}><Monitor className="mr-1 h-3.5 w-3.5" />Desktop</Button><Button aria-label="Mobile preview" onClick={() => setDevice("mobile")} size="sm" variant={device === "mobile" ? "secondary" : "ghost"}><Smartphone className="mr-1 h-3.5 w-3.5" />Mobile</Button></div>
          </div>
           <div className="flex min-h-[620px] items-start justify-center bg-muted/50 p-6"><EmailArtwork imageSrc={activeImage} mobile={device === "mobile"} /></div>
        </main>

        <aside className="w-full border-t border-border bg-card lg:w-80 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><p className="text-sm font-bold">Block settings</p><p className="text-xs text-muted-foreground">{selected?.label ?? "Nothing selected"}</p></div><Button aria-label="More block options" size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></div>
          {selected ? <div className="space-y-5 p-4"><div className="space-y-2"><Label htmlFor="block-heading">Content</Label><Textarea id="block-heading" onChange={markDirty} value={selected.type === "heading" ? "Your next adventure starts here" : selected.summary} /></div><div className="space-y-2"><Label htmlFor="link">Link destination</Label><Input id="link" onChange={markDirty} placeholder="https://adventurezone.com/visit" /></div><div className="flex items-center justify-between border-t border-border pt-4"><div><p className="text-sm font-semibold">Show on mobile</p><p className="text-xs text-muted-foreground">Keep this block responsive</p></div><Switch defaultChecked onCheckedChange={markDirty} /></div><Button className="w-full gap-2" onClick={removeBlock} variant="outline"><Trash2 className="h-4 w-4" />Remove block</Button></div> : <div className="p-6 text-sm text-muted-foreground">Select a block in the content panel to edit its copy, links, and responsive behavior.</div>}
            <div className="m-4 border border-primary/20 bg-primary/5 p-3"><div className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-xs font-bold">Smart content is ready</p><Button aria-label="Toggle AI helper" className="h-6 w-6" onClick={() => setAiExpanded(!aiExpanded)} size="icon" variant="ghost">{aiExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <WandSparkles className="h-3.5 w-3.5" />}</Button></div><p className="mt-1 text-xs text-muted-foreground">Use contact and event fields to personalize every send.</p>{aiExpanded ? <div className="mt-3 space-y-2 border-t border-primary/10 pt-3"><div className="flex items-center gap-1.5 text-[11px] font-semibold"><Bot className="h-3.5 w-3.5" />AI helper <Button className="ml-auto h-6 px-2 text-[9px]" onClick={() => setShowApiConnect(true)} size="sm" variant="secondary">{apiConnected ? "Connected" : "Connect API"}</Button></div><Textarea aria-label="Ask AI helper" className="min-h-16 bg-background text-xs" onChange={(event) => setAiPrompt(event.target.value)} placeholder="Ask for a subject line, rewrite, or CTA..." value={aiPrompt} /><div className="flex flex-wrap gap-1.5"><Button onClick={() => runAiHelper("Write 3 subject lines for this email.")} size="sm" variant="outline">Subject lines</Button><Button onClick={() => runAiHelper()} size="sm" variant="outline">{aiThinking ? "Thinking..." : "Improve copy"}</Button></div>{aiSuggestion ? <div className="border-l-2 border-primary bg-background p-2 text-[11px] leading-4">{aiSuggestion}</div> : <p className="text-[10px] text-muted-foreground">{apiConnected ? "Connected to your workspace AI provider." : "Connect your API to generate copy and images here."}</p>}</div> : null}</div></div></div>
        </aside>
      </div>

      <Dialog open={showApiConnect} onOpenChange={setShowApiConnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect your AI helper</DialogTitle>
            <DialogDescription>Choose the workspace provider used for copy suggestions and image ideas. Secrets stay server-side in the production connection.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider endpoint</Label>
              <Input id="ai-provider" defaultValue="Adventure Zone AI gateway" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model label</Label>
              <Input id="ai-model" defaultValue="Campaign copy assistant" />
            </div>
            <div className="border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
              The builder will send only the selected block, approved brand rules, and the prompt. Recipient data and API keys stay out of the browser.
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowApiConnect(false)} variant="outline">Cancel</Button>
            <Button onClick={() => { setApiConnected(true); setShowApiConnect(false); }}>Connect workspace AI</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showReview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"><Card className="w-full max-w-lg"><CardHeader className="flex-row items-start justify-between"><div><CardTitle>Review before publishing</CardTitle><p className="mt-1 text-sm text-muted-foreground">Save this email to the reusable template library.</p></div><Button aria-label="Close review" onClick={() => setShowReview(false)} size="icon" variant="ghost"><X className="h-4 w-4" /></Button></CardHeader><CardContent className="space-y-4"><div className="space-y-3 border border-border p-4 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Template name</span><strong>{projectName}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Content blocks</span><strong>{blocks.length}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Responsive check</span><span className="flex items-center gap-1 text-primary"><Check className="h-4 w-4" />Desktop + mobile</span></div></div><div className="flex gap-2"><Button className="flex-1" onClick={() => { setPublishState("Needs review"); setShowReview(false); }}>Mark needs review</Button><Button className="flex-1" onClick={() => { setPublishState("Published"); setSaved(true); setShowReview(false); }} variant="outline">Publish template</Button></div><p className="text-center text-xs text-muted-foreground">Publishing adds this version to Template Library for campaign use.</p></CardContent></Card></div> : null}
      <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 border border-border bg-card px-3 py-2 text-xs shadow-lg"><span className="font-semibold">Publish state</span><Badge variant={publishState === "Published" ? "default" : "outline"}>{publishState}</Badge></div>
    </div>
  );
}