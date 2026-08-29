import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Boxes, CheckCircle2, Clock3, FolderOpen, LayoutTemplate, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { designStudioApi, type DesignAsset, type DesignProject, type DesignTemplate, type DesignType } from "@/lib/design-studio-api";

const creationTypes: Array<{ type: DesignType; description: string }> = [
  { type: "flyer", description: "Promote an upcoming adventure with a clear call to action." },
  { type: "social post", description: "Create a quick, on-brand post for your next story." },
  { type: "email", description: "Draft a warm, useful update for families and groups." },
  { type: "brochure", description: "Lay out the details guests need before they book." },
  { type: "review request", description: "Follow up after an event and invite a review." },
  { type: "contract", description: "Start from a protected agreement outline." },
  { type: "blank", description: "Start with a clean canvas and shape it your way." },
];

function dateLabel(value?: string) {
  if (!value) return "Not yet saved";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Recently updated" : `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function DesignStudioPage() {
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [templates, setTemplates] = useState<DesignTemplate[]>([]);
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [creating, setCreating] = useState<DesignType | null>(null);

  async function loadStudio() {
    setLoading(true);
    setError(null);
    try {
      const [nextProjects, nextTemplates, nextAssets] = await Promise.all([
        designStudioApi.list(),
        designStudioApi.listTemplates(),
        designStudioApi.listAssets(),
      ]);
      setProjects(nextProjects);
      setTemplates(nextTemplates);
      setAssets(nextAssets);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Design Studio could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStudio(); }, []);

  const visibleProjects = useMemo(
    () => projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()) || project.type.includes(search.toLowerCase())),
    [projects, search],
  );
  const visibleTemplates = useMemo(
    () => templates.filter((template) => (template.name.toLowerCase().includes(templateSearch.toLowerCase()) || template.type.includes(templateSearch.toLowerCase())) && (!showFavorites || template.isFavorite)),
    [templates, templateSearch, showFavorites],
  );
  const lifecycle = useMemo(() => ({
    draft: projects.filter((project) => !project.status || project.status === "draft").length,
    ready: projects.filter((project) => project.status === "ready").length,
    used: projects.filter((project) => project.status === "used").length,
    sent: projects.filter((project) => project.status === "sent").length,
    archived: projects.filter((project) => project.status === "archived").length,
  }), [projects]);
  const contracts = projects.filter((project) => project.type === "contract");

  async function startProject(type: DesignType, template?: DesignTemplate) {
    setCreating(type);
    try {
      const project = await designStudioApi.create({
        type,
        name: template?.name ?? `${type === "blank" ? "Untitled design" : `${type[0]!.toUpperCase()}${type.slice(1)} concept`}`,
      });
      setLocation(`/design-studio/${project.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The new project could not be created.");
    } finally {
      setCreating(null);
    }
  }

  async function favoriteTemplate(template: DesignTemplate) {
    try {
      const result = await designStudioApi.favoriteTemplate(template.id);
      setTemplates((items) => items.map((item) => item.id === template.id ? { ...item, isFavorite: result.isFavorite } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That favorite could not be updated.");
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-7">
      <header className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
        <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-primary"><Sparkles className="h-4 w-4" />Adventure Zone Studio</div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Make the next adventure memorable.</h1>
            <p className="mt-3 text-base text-muted-foreground">Create polished flyers, emails, contracts, and campaign pieces in one focused workspace. Command Center data stays the source of truth.</p>
          </div>
          <Button onClick={() => void startProject("blank")} disabled={creating !== null}><Plus className="mr-2 h-4 w-4" />New blank design</Button>
        </div>
      </header>

      {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert" data-testid="status-studio-error"><span>{error}</span><Button data-testid="button-retry-studio" onClick={() => void loadStudio()} size="sm" variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div> : null}

      <section aria-labelledby="create-heading">
        <div className="mb-3"><h2 className="text-xl font-bold" id="create-heading">Create new</h2><p className="mt-1 text-sm text-muted-foreground">Start with a format that fits the handoff.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {creationTypes.map(({ type, description }, index) => <Button className="group h-auto min-h-32 w-full justify-start rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-card hover:shadow-md" data-testid={`button-create-${type.replaceAll(" ", "-")}`} disabled={creating !== null} key={type} onClick={() => void startProject(type)} variant="outline">
            <div className="flex w-full items-start justify-between"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${index % 2 ? "bg-accent/20 text-accent-foreground" : "bg-secondary text-secondary-foreground"}`}><LayoutTemplate className="h-4 w-4" /></span><ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" /></div>
            <h3 className="mt-3 font-bold capitalize">{creating === type ? "Creating…" : type}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </Button>)}
        </div>
      </section>

      <section aria-labelledby="templates-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold" id="templates-heading">Template browser</h2><p className="mt-1 text-sm text-muted-foreground">Approved starting points keep brand and legal content protected.</p></div><div className="flex w-full gap-2 sm:w-auto"><div className="relative w-full sm:w-56"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search templates" className="pl-9" onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Search templates" value={templateSearch} /></div><Button aria-pressed={showFavorites} onClick={() => setShowFavorites((value) => !value)} size="sm" variant={showFavorites ? "default" : "outline"}><Star className="mr-1 h-4 w-4" />Favorites</Button></div></div>
        {loading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <Skeleton className="h-28 rounded-xl" key={item} />)}</div> : visibleTemplates.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{visibleTemplates.map((template) => <Card className="group" key={template.id}><CardHeader className="pb-2"><div className="flex items-start justify-between gap-2"><CardTitle className="text-sm">{template.name}</CardTitle><button aria-label={`${template.isFavorite ? "Remove" : "Add"} ${template.name} favorite`} className="text-muted-foreground hover:text-primary" onClick={() => void favoriteTemplate(template)} type="button"><Star className={`h-4 w-4 ${template.isFavorite ? "fill-current text-primary" : ""}`} /></button></div></CardHeader><CardContent className="pt-0"><p className="line-clamp-2 text-xs text-muted-foreground">{template.description ?? "A reusable Adventure Zone starting point."}</p><Button className="mt-3 w-full" onClick={() => void startProject(template.type, template)} size="sm" variant="outline">Use template</Button></CardContent></Card>)}</div> : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{showFavorites ? "No favorite templates yet." : "No templates match that search."}</CardContent></Card>}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader><div className="flex flex-wrap items-end justify-between gap-3"><div><CardTitle>My designs</CardTitle><p className="mt-1 text-sm text-muted-foreground">{projects.length ? `${projects.length} saved project${projects.length === 1 ? "" : "s"}` : "Your saved work will appear here."}</p></div><div className="relative w-full sm:w-56"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search projects" className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search designs" value={search} /></div></div></CardHeader>
          <CardContent>{loading ? <div className="grid gap-3 sm:grid-cols-2">{[1, 2].map((item) => <Skeleton className="h-20 rounded-lg" key={item} />)}</div> : visibleProjects.length ? <div className="grid gap-3 sm:grid-cols-2">{visibleProjects.slice(0, 6).map((project) => <Link className="group rounded-lg border border-border p-3 transition hover:border-primary/60" data-testid={`link-project-${project.id}`} href={`/design-studio/${project.id}`} key={project.id}><div className="flex items-start justify-between gap-2"><div><h3 className="font-bold">{project.name}</h3><p className="mt-1 text-xs capitalize text-muted-foreground">{label(project.type)} · {dateLabel(project.updatedAt)}</p></div><Badge variant={project.status === "sent" ? "default" : "secondary"}>{project.status ?? "draft"}</Badge></div></Link>)}</div> : <div className="flex flex-col items-center justify-center py-8 text-center"><FolderOpen className="h-8 w-8 text-muted-foreground" /><h3 className="mt-3 font-bold">{search ? "No matching designs" : "Your studio is ready"}</h3><p className="mt-1 text-sm text-muted-foreground">Choose a format above to begin.</p></div>}</CardContent>
        </Card>
        <div className="grid gap-4">
          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" />Lifecycle</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 text-sm">{(["draft", "ready", "used", "sent", "archived"] as const).map((state) => <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-2" key={state}><span className="capitalize text-muted-foreground">{state}</span><strong>{lifecycle[state]}</strong></div>)}</CardContent></Card>
          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />Contracts</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{contracts.length ? `${contracts.length} contract project${contracts.length === 1 ? "" : "s"} in your designs.` : "No contract projects yet."}</p><p className="mt-2 text-xs text-muted-foreground">Sent versions are immutable. Signing and countersigning always require an explicit action.</p></CardContent></Card>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="h-5 w-5 text-primary" />Brand Library</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Browse approved company, package, event, profile, and project assets without changing the Command Center source records.</p><Button className="mt-4" onClick={() => setShowLibrary((value) => !value)} variant="outline">{showLibrary ? "Hide library" : "Open Brand Library"}<ArrowRight className="ml-2 h-4 w-4" /></Button>{showLibrary ? <div className="mt-4 grid gap-2">{assets.length ? assets.slice(0, 5).map((asset) => <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm" key={asset.id}><span>{asset.name}</span><Badge variant="outline">{asset.scope}</Badge></div>) : <p className="text-sm text-muted-foreground">No shared assets have been added yet.</p>}</div> : null}</CardContent></Card>
        <Card className="border-primary/20 bg-primary/5"><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />AI create</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Ask for copy or layout suggestions, then review every change before it touches a project. Locked brand and legal content stays protected.</p><Button className="mt-4" onClick={() => setError("AI suggestions are review-only in V1. Open a project to apply an approved suggestion.")} variant="outline"><CheckCircle2 className="mr-2 h-4 w-4" />Get a suggestion</Button></CardContent></Card>
      </section>
    </div>
  );
}