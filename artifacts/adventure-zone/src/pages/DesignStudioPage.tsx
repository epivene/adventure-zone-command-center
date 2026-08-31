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
  Trash2,
} from "lucide-react";
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
import { designStudioApi, type DesignProject, type DesignType } from "@/lib/design-studio-api";
import { CANVA_STARTERS, type CanvaStarter } from "@/lib/design-studio/canva-starters";

const CANVA_CREATE_URL = "https://www.canva.com/create/";

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

function TemplatePreview({ starter }: { starter: CanvaStarter }) {
  if (starter.id === "event-flyer") {
    return (
      <div className="mx-auto aspect-[8.5/11] w-44 overflow-hidden rounded-md bg-[#fff7e8] shadow-xl ring-1 ring-black/10">
        <div className="bg-[#18243a] px-3 py-4 text-white">
          <p className="text-[6px] font-black tracking-[0.22em]">THE ADVENTURE ZONE</p>
          <p className="mt-1 text-[16px] font-black leading-[0.95]">FAMILY FUN<br />IS COMING!</p>
        </div>
        <div className="space-y-3 p-3">
          <div>
            <p className="text-[12px] font-black text-[#e6427a]">[EVENT NAME]</p>
            <p className="text-[7px] font-bold text-[#18243a]">[DATE] • [TIME]</p>
            <p className="text-[6px] text-slate-500">[VENUE / CITY, STATE]</p>
          </div>
          <div className="border-l-4 border-[#f4c542] pl-2">
            <p className="text-[7px] font-black text-[#18243a]">10 ATTRACTIONS. ONE BIG ADVENTURE.</p>
            <p className="mt-1 text-[5px] leading-tight text-slate-500">Slides • obstacle courses • interactive games • bounce houses</p>
          </div>
          <div className="rounded-md bg-[#e6427a] p-2 text-white">
            <p className="text-[7px] font-black">COME PLAY WITH US!</p>
            <p className="text-[5px]">Tickets / admission details</p>
          </div>
        </div>
      </div>
    );
  }

  if (starter.id === "social-post") {
    return (
      <div className="relative mx-auto aspect-[4/5] w-44 overflow-hidden rounded-md bg-[#18243a] p-4 text-white shadow-xl ring-1 ring-black/10">
        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#f4c542]" />
        <div className="absolute -bottom-10 -left-10 h-28 w-28 rounded-full bg-[#e6427a]" />
        <p className="relative text-[6px] font-black tracking-[0.2em]">THE ADVENTURE ZONE</p>
        <p className="relative mt-8 text-[20px] font-black leading-[0.9]">WEEKEND<br />PLANS?<br /><span className="text-[#f4c542]">SOLVED.</span></p>
        <p className="relative mt-5 text-[7px]">Find us at <b>[EVENT NAME]</b><br />[DATE] • [CITY, STATE]</p>
        <div className="relative mt-5 rounded-full border border-white px-2 py-1 text-center text-[5px] font-bold">Slides • Games • Challenges • Bounce</div>
      </div>
    );
  }

  if (starter.id === "last-minute-booking") {
    return (
      <div className="mx-auto aspect-[4/5] w-44 overflow-hidden rounded-md bg-[#fffaf0] shadow-xl ring-1 ring-black/10">
        <div className="bg-[#e6427a] px-3 py-3 text-[6px] font-black tracking-[0.15em] text-white">OPEN DATE ALERT</div>
        <div className="p-4">
          <p className="text-[19px] font-black leading-[0.9] text-[#18243a]">NEED<br />FAMILY FUN<br /><span className="text-[#e6427a]">FAST?</span></p>
          <p className="mt-4 text-[6px] text-slate-500">Opening near [REGION / ROUTE]</p>
          <p className="text-[9px] font-black text-[#18243a]">[AVAILABLE DATE]</p>
          <div className="mt-4 rounded-md bg-[#f4c542] p-2 text-[#18243a]">
            <p className="text-[6px] font-black">A COMPLETE STAFFED ATTRACTION AREA</p>
            <p className="mt-1 text-[5px]">Set-up • tear-down • staffing • insured</p>
          </div>
          <p className="mt-4 text-[7px] font-black text-[#e6427a]">Booking: (435) 760-5583</p>
        </div>
      </div>
    );
  }

  if (starter.id === "package-overview") {
    return (
      <div className="mx-auto aspect-[8.5/11] w-44 overflow-hidden rounded-md bg-slate-50 shadow-xl ring-1 ring-black/10">
        <div className="bg-[#18243a] px-3 py-3 text-white">
          <p className="text-[5px] font-black tracking-[0.2em]">THE ADVENTURE ZONE</p>
          <p className="mt-1 text-[11px] font-black">3 WAYS TO BRING THE FUN</p>
        </div>
        <div className="space-y-2 p-3">
          <div className="border-l-4 border-[#e6427a] bg-white p-2"><p className="text-[7px] font-black">ADVENTURE ZONE</p><p className="text-[6px] font-black text-[#e6427a]">$9,000 • 1–4 days</p></div>
          <div className="border-l-4 border-sky-400 bg-white p-2"><p className="text-[7px] font-black">PIRATE’S REBELLION</p><p className="text-[6px] font-black text-sky-600">$7,500 • 1–4 days</p></div>
          <div className="border-l-4 border-amber-400 bg-white p-2"><p className="text-[7px] font-black">WARRIOR’S PLAYGROUND</p><p className="text-[6px] font-black text-amber-600">$7,500 • 1–4 days</p></div>
          <div className="rounded bg-[#f4c542] p-2 text-[5px] font-bold text-[#18243a]">SET-UP • STAFFING • $2M INSURANCE • TEAR-DOWN</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto aspect-square w-44 overflow-hidden rounded-md bg-[#fff8e7] p-5 text-center shadow-xl ring-1 ring-black/10">
      <div className="absolute -left-7 -top-7 h-20 w-20 rounded-full bg-[#e6427a]" />
      <div className="absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-[#f4c542]" />
      <p className="relative text-[6px] font-black tracking-[0.2em] text-[#18243a]">THE ADVENTURE ZONE</p>
      <p className="relative mt-6 text-[18px] font-black leading-none text-[#18243a]">HOW DID<br />WE DO?</p>
      <p className="relative mt-3 text-[11px] tracking-widest text-[#e6427a]">★★★★★</p>
      <div className="relative mt-5 rounded-full bg-[#18243a] px-2 py-2 text-[6px] font-black text-white">SCAN / CLICK TO REVIEW</div>
    </div>
  );
}

function StarterCard({ starter, creating, onUse }: { starter: CanvaStarter; creating: boolean; onUse: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex min-h-64 items-center justify-center border-b bg-[radial-gradient(circle_at_top,_hsl(var(--muted)),_transparent_70%)] p-5">
        <TemplatePreview starter={starter} />
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="gap-1.5 capitalize">
            {typeIcon[starter.type] ?? <Sparkles className="h-4 w-4" />}
            {starter.type}
          </Badge>
          <span className="text-xs font-semibold text-muted-foreground">{starter.canvasSize}</span>
        </div>
        <h3 className="mt-3 font-black text-foreground">{starter.name}</h3>
        <p className="mt-1.5 min-h-10 text-sm leading-relaxed text-muted-foreground">{starter.description}</p>
        <Button className="mt-4 w-full gap-2" disabled={creating} onClick={onUse}>
          {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {creating ? "Creating…" : "Use this design"}
        </Button>
      </div>
    </article>
  );
}

function ProjectCard({ project, deleting, onDelete }: { project: DesignProject; deleting: boolean; onDelete: () => void }) {
  const status = project.status ?? "draft";
  return (
    <article className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
      <Link className="block" href={`/design-studio/${project.id}`}>
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
              <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
              <AlertDialogDescription>This removes the design from your active Design Studio. This cannot be undone from this screen.</AlertDialogDescription>
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

export default function DesignStudioPage() {
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
      const loaded = await designStudioApi.list();
      setProjects(loaded.filter((project) => project.status !== "archived"));
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

  async function deleteProject(project: DesignProject) {
    setDeletingId(project.id);
    setError(null);
    try {
      await designStudioApi.remove(project.id);
      setProjects((items) => items.filter((item) => item.id !== project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The design could not be deleted.");
    } finally {
      setDeletingId(null);
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
          <h1 className="mt-5 text-3xl font-black tracking-tight md:text-5xl">Choose the look here. Finish it in Canva.</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-sidebar-foreground/70">See the actual Adventure Zone layout before you pick it. Command Center keeps the design organized; Canva handles the visual editing without requiring Brand Kit or Autofill.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="gap-2" onClick={() => document.getElementById("starter-templates")?.scrollIntoView({ behavior: "smooth" })}><Sparkles className="h-4 w-4" />Choose a starter</Button>
            <Button className="gap-2 border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent" variant="outline" onClick={() => window.open(CANVA_CREATE_URL, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" />Open Canva Free</Button>
          </div>
        </div>
      </header>

      {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert"><span className="text-destructive">{error}</span><Button onClick={() => void loadProjects()} size="sm" variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div> : null}

      <section id="starter-templates" aria-labelledby="starter-heading">
        <div className="mb-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Built for Adventure Zone</p><h2 className="mt-1 text-2xl font-black tracking-tight" id="starter-heading">Visual starter templates</h2><p className="mt-1 text-sm text-muted-foreground">What you see on the card is the layout you’re starting from — not just a text prompt.</p></div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{CANVA_STARTERS.map((starter) => <StarterCard key={starter.id} starter={starter} creating={creatingId === starter.id} onUse={() => void useStarter(starter)} />)}</div>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Saved work</p><h2 className="mt-1 text-2xl font-black tracking-tight">My designs</h2><p className="mt-1 text-sm text-muted-foreground">Open a design to work with it, or delete old designs you no longer want in the Studio.</p></div>
          <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search designs" value={search} /></div>
        </div>

        {loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-40 rounded-xl" />)}</div> : visibleProjects.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleProjects.map((project) => <ProjectCard key={project.id} project={project} deleting={deletingId === project.id} onDelete={() => void deleteProject(project)} />)}</div> : <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center"><FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-bold">No matching designs yet.</p><p className="mt-1 text-sm text-muted-foreground">Pick one of the visual starters above and it will show up here.</p></div>}
      </section>
    </div>
  );
}
