import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  FileText,
  FolderOpen,
  Image,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { designStudioApi, type DesignProject, type DesignType } from "@/lib/design-studio-api";
import { CANVA_STARTERS, type CanvaStarter } from "@/lib/design-studio/canva-starters";

const CANVA_CREATE_URL = "https://www.canva.com/create/";

const accentClass: Record<CanvaStarter["accent"], string> = {
  pink: "from-pink-500/25 via-pink-400/10 to-background border-pink-500/30",
  yellow: "from-yellow-400/30 via-yellow-300/10 to-background border-yellow-400/40",
  blue: "from-sky-500/25 via-sky-400/10 to-background border-sky-500/30",
  orange: "from-orange-500/25 via-orange-400/10 to-background border-orange-500/30",
  navy: "from-slate-900/25 via-slate-700/10 to-background border-slate-700/30",
};

const typeIcon: Partial<Record<DesignType, React.ReactNode>> = {
  flyer: <FileText className="h-4 w-4" />,
  "social post": <Image className="h-4 w-4" />,
  brochure: <FileText className="h-4 w-4" />,
  "review request": <MessageSquare className="h-4 w-4" />,
};

function dateLabel(value?: string) {
  if (!value) return "Not yet saved";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Recently updated"
    : `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function StarterCard({ starter, creating, onUse }: { starter: CanvaStarter; creating: boolean; onUse: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className={`relative min-h-52 border-b bg-gradient-to-br p-5 ${accentClass[starter.accent]}`}>
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="gap-1.5 capitalize">
            {typeIcon[starter.type] ?? <Sparkles className="h-4 w-4" />}
            {starter.type}
          </Badge>
          <span className="text-xs font-semibold text-muted-foreground">{starter.canvasSize}</span>
        </div>
        <div className="mt-12 max-w-[90%]">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{starter.eyebrow}</p>
          <h3 className="mt-2 text-3xl font-black tracking-tight text-foreground">{starter.headline}</h3>
        </div>
        <div className="absolute bottom-4 right-5 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur">
          Free Canva starter
        </div>
      </div>
      <div className="p-5">
        <h3 className="font-black text-foreground">{starter.name}</h3>
        <p className="mt-1.5 min-h-10 text-sm leading-relaxed text-muted-foreground">{starter.description}</p>
        <Button className="mt-4 w-full gap-2" disabled={creating} onClick={onUse}>
          {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {creating ? "Creating…" : "Use this template"}
        </Button>
      </div>
    </article>
  );
}

function ProjectCard({ project }: { project: DesignProject }) {
  const status = project.status ?? "draft";
  return (
    <Link
      className="group rounded-xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      href={`/design-studio/${project.id}`}
    >
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
        <div className="text-center">
          <FolderOpen className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Canva project</p>
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-foreground">{project.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{dateLabel(project.updatedAt)}</p>
        </div>
        <Badge variant="outline" className="shrink-0 capitalize">{status}</Badge>
      </div>
    </Link>
  );
}

export default function DesignStudioPage() {
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creatingId, setCreatingId] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      setProjects(await designStudioApi.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Design Studio could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProjects(); }, []);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(query) || project.type.toLowerCase().includes(query));
  }, [projects, search]);

  async function useStarter(starter: CanvaStarter) {
    setCreatingId(starter.id);
    setError(null);
    try {
      const project = await designStudioApi.create({
        type: starter.type,
        name: starter.name,
        content: starter.content,
        notes: `CANVA_STARTER_ID=${starter.id}`,
      });
      setLocation(`/design-studio/${project.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The starter project could not be created.");
    } finally {
      setCreatingId(null);
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-8 pb-12">
      <header className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-lg md:p-10">
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-24 h-60 w-60 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em]">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Design Studio + Canva Free
          </div>
          <h1 className="mt-5 text-3xl font-black tracking-tight md:text-5xl">Make it here. Edit it in Canva.</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-sidebar-foreground/70">
            Command Center keeps your starter designs, event copy, and saved Canva links organized. Canva handles the visual editing — no paid Brand Kit or Autofill required.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="gap-2" onClick={() => document.getElementById("starter-templates")?.scrollIntoView({ behavior: "smooth" })}>
              <Sparkles className="h-4 w-4" />
              Choose a starter
            </Button>
            <Button
              className="gap-2 border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent"
              variant="outline"
              onClick={() => window.open(CANVA_CREATE_URL, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4" />
              Open Canva Free
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void loadProjects()} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : null}

      <section id="starter-templates" aria-labelledby="starter-heading">
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Built for Adventure Zone</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight" id="starter-heading">Starter templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">These are normal free-Canva workflows — no Pro template features required.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {CANVA_STARTERS.map((starter) => (
            <StarterCard
              key={starter.id}
              starter={starter}
              creating={creatingId === starter.id}
              onUse={() => void useStarter(starter)}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Saved work</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">My designs</h2>
            <p className="mt-1 text-sm text-muted-foreground">Open a project to copy its prepared content, launch Canva, and save the Canva link back here.</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search designs" value={search} />
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-40 rounded-xl" />)}
          </div>
        ) : visibleProjects.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-bold">No matching designs yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Pick one of the starters above and it will show up here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
