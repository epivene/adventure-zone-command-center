// Boss Design Studio — uses Boss token via bossDesignStudioApi
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileText, FolderOpen, Image, MessageSquare, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/avz-crm/components/ui/alert-dialog";
import { bossDesignStudioApi } from "@/lib/boss-design-studio-api";
import { CANVA_STARTERS } from "@/lib/design-studio/canva-starters";
import type { DesignProject, DesignType } from "@/lib/design-studio-api";

const typeIcon: Partial<Record<DesignType, React.ReactNode>> = {
  flyer: <FileText className="h-4 w-4" />,
  "social post": <Image className="h-4 w-4" />,
  brochure: <FileText className="h-4 w-4" />,
  "review request": <MessageSquare className="h-4 w-4" />,
};

function dateLabel(value?: string) {
  if (!value) return "Not yet saved";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Recently updated" : `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function ProjectCard({ project, deleting, onDelete }: { project: DesignProject; deleting: boolean; onDelete(): void }) {
  const status = project.status ?? "draft";
  return (
    <article className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
      <Link className="block" href={`/boss/design-studio/${project.id}`}>
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <div className="text-center">
            <FolderOpen className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Studio project</p>
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
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="gap-1.5 text-destructive" disabled={deleting} size="sm" variant="ghost">
              {deleting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
              <AlertDialogDescription>This removes the design from the Studio. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete design</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}

export default function BossDesignStudioPage() {
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const loaded = await bossDesignStudioApi.list();
      setProjects(loaded.filter((p) => p.status !== "archived"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Design Studio could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProjects(); }, []);

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q));
  }, [projects, search]);

  async function useStarter(starterId: string, starterName: string, type: DesignType, content?: string, canvas?: Record<string, unknown>) {
    setCreatingId(starterId);
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const project = await bossDesignStudioApi.create({ type, name: starterName, content, canvas } as any);
      // Immediately patch with notes so the editor can identify the starter
      await bossDesignStudioApi.update(project.id, { notes: `CANVA_STARTER_ID=${starterId}` });
      setLocation(`/boss/design-studio/${project.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create starter project.");
    } finally {
      setCreatingId(null);
    }
  }

  async function deleteProject(project: DesignProject) {
    setDeletingId(project.id);
    setError(null);
    try {
      await bossDesignStudioApi.remove(project.id);
      setProjects((items) => items.filter((item) => item.id !== project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The design could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid gap-8 pb-12" data-testid="boss-design-studio-page">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
        <h1 className="mt-0.5 text-2xl font-bold text-foreground">Design Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Create, review, and manage design projects.</p>
      </header>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void loadProjects()} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </div>
      ) : null}

      {/* Quick starters */}
      <section>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Start new</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CANVA_STARTERS.map((starter) => (
            <article key={starter.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="gap-1 capitalize">
                  {typeIcon[starter.type] ?? <Sparkles className="h-4 w-4" />}
                  {starter.type}
                </Badge>
              </div>
              <p className="font-bold text-foreground">{starter.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{starter.description}</p>
              <Button
                className="mt-3 w-full gap-2"
                size="sm"
                disabled={creatingId === starter.id}
                onClick={() => void useStarter(starter.id, starter.name, starter.type, starter.content, starter.canvas)}
                data-testid={`button-starter-${starter.id}`}
              >
                {creatingId === starter.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                {creatingId === starter.id ? "Creating…" : "Use"}
              </Button>
            </article>
          ))}
        </div>
      </section>

      {/* Existing projects */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Saved work</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">My designs</p>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search designs"
              value={search}
              data-testid="input-studio-search"
            />
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        ) : visibleProjects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                deleting={deletingId === project.id}
                onDelete={() => void deleteProject(project)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center" data-testid="studio-empty">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-bold text-foreground">No designs yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Use a starter above to create your first design.</p>
          </div>
        )}
      </section>
    </div>
  );
}
