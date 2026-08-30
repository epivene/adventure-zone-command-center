import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock3,
  FolderOpen,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  FileText,
  Mail,
  Image,
  BookOpen,
  MessageSquare,
  Pencil,
  Grid3x3,
  ChevronRight,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Separator } from "@workspace/avz-crm/components/ui/separator";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { designStudioApi, type DesignAsset, type DesignProject, type DesignTemplate, type DesignType } from "@/lib/design-studio-api";
import { createStarterCanvas, starterContent } from "@/lib/design-studio/starter-templates";

const TYPE_META: Record<DesignType, { icon: React.ReactNode; accent: string }> = {
  flyer: {
    icon: <FileText className="h-5 w-5" />,
    accent: "bg-primary/10 text-primary border-primary/20",
  },
  "social post": {
    icon: <Image className="h-5 w-5" />,
    accent: "bg-accent/20 text-accent-foreground border-accent/30",
  },
  email: {
    icon: <Mail className="h-5 w-5" />,
    accent: "bg-secondary text-secondary-foreground border-secondary-foreground/10",
  },
  brochure: {
    icon: <BookOpen className="h-5 w-5" />,
    accent: "bg-chart-3/10 text-foreground border-border",
  },
  "review request": {
    icon: <MessageSquare className="h-5 w-5" />,
    accent: "bg-primary/5 text-primary border-primary/15",
  },
  contract: {
    icon: <ShieldCheck className="h-5 w-5" />,
    accent: "bg-muted text-muted-foreground border-border",
  },
  blank: {
    icon: <Pencil className="h-5 w-5" />,
    accent: "bg-secondary/60 text-secondary-foreground border-border",
  },
};

const creationTypes: Array<{ type: DesignType; description: string }> = [
  { type: "flyer", description: "Promote an upcoming adventure with a clear call to action." },
  { type: "social post", description: "Create a quick, on-brand post for your next story." },
  { type: "email", description: "Draft a warm, useful update for families and groups." },
  { type: "brochure", description: "Lay out the details guests need before they book." },
  { type: "review request", description: "Follow up after an event and invite a review." },
  { type: "contract", description: "Start from a protected agreement outline." },
  { type: "blank", description: "Start with a clean canvas and shape it your way." },
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-primary/10 text-primary",
  used: "bg-accent/20 text-accent-foreground",
  sent: "bg-primary text-primary-foreground",
  archived: "bg-muted/60 text-muted-foreground",
};

function dateLabel(value?: string) {
  if (!value) return "Not yet saved";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Recently updated" : `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function ProjectCard({ project }: { project: DesignProject }) {
  const meta = TYPE_META[project.type] ?? TYPE_META.blank;
  const status = project.status ?? "draft";
  return (
    <Link
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`link-project-${project.id}`}
      href={`/design-studio/${project.id}`}
    >
      <div className={`flex h-24 items-center justify-center rounded-lg border ${meta.accent} transition-colors`}>
        <div className="flex flex-col items-center gap-2">
          {meta.icon}
          <span className="text-xs font-semibold uppercase tracking-wider opacity-70 capitalize">{project.type}</span>
        </div>
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{project.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{dateLabel(project.updatedAt)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_COLORS[status] ?? STATUS_COLORS.draft}`}>{status}</span>
      </div>
    </Link>
  );
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
        ...(template ? { canvas: createStarterCanvas(type), content: starterContent(type) } : {}),
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
    <div className="mx-auto grid max-w-7xl gap-8 pb-12">

      {/* Hero banner */}
      <header className="relative overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-lg">
        {/* Decorative carnival stripes */}
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-accent blur-3xl" />
          <div className="absolute -bottom-12 right-12 h-56 w-56 rounded-full bg-primary blur-3xl" />
          <div className="absolute left-1/2 top-0 h-40 w-40 rounded-full bg-accent/60 blur-2xl" />
        </div>
        <div className="relative grid gap-8 p-6 md:grid-cols-[1fr_auto] md:p-10">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sidebar-primary/40 bg-sidebar-primary/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-sidebar-primary-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Adventure Zone Creative Studio
            </div>
            <h1 className="text-3xl font-black tracking-tight text-sidebar-foreground md:text-4xl lg:text-5xl">
              Make the next adventure memorable.
            </h1>
            <p className="mt-3 text-base leading-relaxed text-sidebar-foreground/70">
              Create polished flyers, emails, contracts, and campaign pieces in one focused workspace. Command Center data stays the source of truth.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                className="gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                data-testid="button-create-blank"
                disabled={creating !== null}
                onClick={() => void startProject("blank")}
              >
                <Plus className="h-4 w-4" />
                New blank design
              </Button>
              <Button
                variant="outline"
                className="gap-2 border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => document.getElementById("templates-section")?.scrollIntoView({ behavior: "smooth" })}
              >
                <Grid3x3 className="h-4 w-4" />
                Browse templates
              </Button>
            </div>
          </div>
          {/* Quick stats */}
          <div className="hidden flex-col justify-center gap-3 md:flex">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/30 p-4 text-center">
              <p className="text-3xl font-black text-sidebar-primary-foreground">{projects.length}</p>
              <p className="text-xs text-sidebar-foreground/60 uppercase tracking-wider mt-0.5">Designs</p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/30 p-4 text-center">
              <p className="text-3xl font-black text-accent">{templates.length}</p>
              <p className="text-xs text-sidebar-foreground/60 uppercase tracking-wider mt-0.5">Templates</p>
            </div>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm"
          role="alert"
          data-testid="status-studio-error"
        >
          <span className="text-destructive">{error}</span>
          <Button data-testid="button-retry-studio" onClick={() => void loadStudio()} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : null}

      {/* Create new section */}
      <section aria-labelledby="create-heading">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black tracking-tight" id="create-heading">Create new</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick a format — your first layer is already placed.</p>
          </div>
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-7">
          {creationTypes.map(({ type, description }) => {
            const meta = TYPE_META[type];
            const isCreating = creating === type;
            return (
              <button
                key={type}
                className={`group relative flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 ${meta.accent}`}
                data-testid={`button-create-${type.replaceAll(" ", "-")}`}
                disabled={creating !== null}
                onClick={() => void startProject(type)}
                title={description}
                type="button"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/50 shadow-sm transition-transform group-hover:scale-110">
                  {meta.icon}
                </div>
                <span className="text-xs font-bold capitalize leading-tight">
                  {isCreating ? "Creating..." : type}
                </span>
                {isCreating && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60">
                    <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* My designs + sidebar stats */}
      <section className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black tracking-tight">My designs</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {projects.length ? `${projects.length} saved project${projects.length === 1 ? "" : "s"}` : "Your saved work will appear here."}
              </p>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search projects"
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search designs"
                value={search}
              />
            </div>
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div key={item} className="rounded-xl border border-border p-4">
                  <Skeleton className="h-24 w-full rounded-lg" />
                  <Skeleton className="mt-3 h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : visibleProjects.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleProjects.slice(0, 6).map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mt-4 font-bold">{search ? "No matching designs" : "Your studio is ready"}</h3>
              <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                {search ? "Try a different search term." : "Choose a format above to create your first design."}
              </p>
              {!search && (
                <Button className="mt-5" onClick={() => void startProject("blank")} disabled={creating !== null}>
                  <Plus className="mr-2 h-4 w-4" />
                  New blank design
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar: lifecycle + contracts */}
        <aside className="grid gap-4 self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                <Clock3 className="h-4 w-4 text-primary" />
                Lifecycle
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5">
              {(["draft", "ready", "used", "sent", "archived"] as const).map((state) => (
                <div key={state} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/60 transition-colors">
                  <span className="flex items-center gap-2 text-sm capitalize text-muted-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${state === "sent" ? "bg-primary" : state === "ready" ? "bg-accent" : "bg-muted-foreground/40"}`} />
                    {state}
                  </span>
                  <strong className="text-sm tabular-nums">{lifecycle[state]}</strong>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Contracts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {contracts.length
                  ? `${contracts.length} contract project${contracts.length === 1 ? "" : "s"} in your designs.`
                  : "No contract projects yet."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Sent versions are immutable. Signing and countersigning always require an explicit action.
              </p>
            </CardContent>
          </Card>
        </aside>
      </section>

      <Separator />

      {/* Template browser */}
      <section aria-labelledby="templates-heading" id="templates-section">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black tracking-tight" id="templates-heading">Template browser</h2>
            <p className="mt-1 text-sm text-muted-foreground">Approved starting points keep brand and legal content protected.</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search templates"
                className="pl-9"
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="Search templates"
                value={templateSearch}
              />
            </div>
            <Button
              aria-pressed={showFavorites}
              onClick={() => setShowFavorites((value) => !value)}
              size="sm"
              variant={showFavorites ? "default" : "outline"}
              className="shrink-0"
            >
              <Star className={`mr-1.5 h-4 w-4 ${showFavorites ? "fill-current" : ""}`} />
              Favorites
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="rounded-xl border border-border p-4">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="mt-3 h-4 w-3/4" />
                <Skeleton className="mt-2 h-8 w-full rounded-lg" />
              </div>
            ))}
          </div>
        ) : visibleTemplates.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visibleTemplates.map((template) => {
              const meta = TYPE_META[template.type] ?? TYPE_META.blank;
              return (
                <div
                  key={template.id}
                  className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:border-primary/40 hover:shadow-md"
                >
                  <div className={`flex h-16 items-center justify-center rounded-lg border ${meta.accent}`}>
                    {meta.icon}
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{template.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{template.description ?? "A reusable Adventure Zone starting point."}</p>
                    </div>
                    <button
                      aria-label={`${template.isFavorite ? "Remove" : "Add"} ${template.name} favorite`}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void favoriteTemplate(template)}
                      type="button"
                    >
                      <Star className={`h-4 w-4 ${template.isFavorite ? "fill-current text-primary" : ""}`} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Badge variant="secondary" className="capitalize text-xs">{label(template.type)}</Badge>
                    {template.isApproved && <Badge variant="outline" className="text-xs">Approved</Badge>}
                  </div>
                  <Button
                    className="mt-auto w-full"
                    onClick={() => void startProject(template.type, template)}
                    size="sm"
                    variant="outline"
                    disabled={creating !== null}
                  >
                    Use template
                    <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
            <LayoutTemplate className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-bold">{showFavorites ? "No favorite templates yet." : "No templates match that search."}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {showFavorites ? "Star a template to add it here." : "Try adjusting the search term."}
            </p>
          </div>
        )}
      </section>

      <Separator />

      {/* Brand Library + AI create */}
      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              Brand Library
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Browse approved company, package, event, profile, and project assets without changing the Command Center source records.
            </p>
            <Button
              className="mt-4"
              onClick={() => setShowLibrary((value) => !value)}
              variant="outline"
            >
              {showLibrary ? "Hide library" : "Open Brand Library"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {showLibrary ? (
              <div className="mt-4 grid gap-2">
                {assets.length ? (
                  assets.slice(0, 5).map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors"
                    >
                      <span className="font-medium">{asset.name}</span>
                      <Badge variant="outline" className="capitalize text-xs">{asset.scope}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No shared assets have been added yet.</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI create
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Ask for copy or layout suggestions, then review every change before it touches a project. Locked brand and legal content stays protected.
            </p>
            <Button
              className="mt-4"
              onClick={() => setError("AI suggestions are review-only in V1. Open a project to apply an approved suggestion.")}
              variant="outline"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Get a suggestion
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
