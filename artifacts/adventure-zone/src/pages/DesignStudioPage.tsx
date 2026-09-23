import { useEffect, useMemo, useState } from "react";
import { FolderOpen, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
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
import { TemplateCatalog } from "@/components/design-studio/TemplateCatalog";
import {
  designStudioApi,
  type DesignProject,
  type DesignTemplate,
} from "@/lib/design-studio-api";

function dateLabel(value?: string) {
  if (!value) return "Not yet saved";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Recently updated"
    : `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function ProjectCard({
  project,
  deleting,
  onDelete,
}: {
  project: DesignProject;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
      <Link className="block" href={`/design-studio/${project.id}`}>
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <div className="text-center">
            <FolderOpen className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {project.type}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold text-foreground">{project.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{dateLabel(project.updatedAt)}</p>
          </div>
          <Badge variant="outline" className="shrink-0 capitalize">
            {project.status ?? "draft"}
          </Badge>
        </div>
      </Link>
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="gap-1.5 text-destructive" disabled={deleting} size="sm" variant="ghost">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This archives the draft from the active Design Studio.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Archive draft</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}

export default function DesignStudioPage() {
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [templates, setTemplates] = useState<DesignTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadStudio() {
    setLoading(true);
    setError(null);
    try {
      const [loadedProjects, loadedTemplates] = await Promise.all([
        designStudioApi.list(),
        designStudioApi.listTemplates(),
      ]);
      setProjects(loadedProjects);
      setTemplates(loadedTemplates);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Design Studio could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStudio(); }, []);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      project.name.toLowerCase().includes(query) ||
      project.type.toLowerCase().includes(query),
    );
  }, [projects, search]);

  async function useTemplate(template: DesignTemplate) {
    setCreatingId(template.id);
    setError(null);
    try {
      const project = await designStudioApi.instantiateTemplate(template.id, {
        documentYear: new Date().getFullYear(),
      });
      setLocation(`/design-studio/${project.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The draft could not be created.");
    } finally {
      setCreatingId(null);
    }
  }

  async function archiveProject(project: DesignProject) {
    setDeletingId(project.id);
    setError(null);
    try {
      await designStudioApi.remove(project.id);
      setProjects((items) => items.filter((item) => item.id !== project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The draft could not be archived.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-8 pb-12">
      <header className="rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-lg md:p-8">
        <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]">
          <Sparkles className="h-4 w-4 text-accent" />
          Adventure Zone Design Studio
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Current templates</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sidebar-foreground/75">
          Start an email, contract, or proposal using the current approved Adventure Zone information.
        </p>
      </header>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void loadStudio()} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="current-template-heading">
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Approved catalog</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight" id="current-template-heading">
            Choose a template
          </h2>
        </div>
        {loading
          ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-48 rounded-xl" />)}</div>
          : <TemplateCatalog templates={templates} creatingId={creatingId} onUse={(template) => void useTemplate(template)} />}
      </section>

      <section aria-labelledby="saved-work-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Saved work</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight" id="saved-work-heading">Current drafts</h2>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search drafts" value={search} />
          </div>
        </div>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-40 rounded-xl" />)}
          </div>
        ) : visibleProjects.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                deleting={deletingId === project.id}
                onDelete={() => void archiveProject(project)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-bold">No current drafts.</p>
            <p className="mt-1 text-sm text-muted-foreground">Choose a current template above to begin.</p>
          </div>
        )}
      </section>
    </div>
  );
}
