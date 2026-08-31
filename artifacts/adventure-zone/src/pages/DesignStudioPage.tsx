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
const LOGO_SRC = `${import.meta.env.BASE_URL}adventure-zone-logo.png`;
const NAVY = "#11192d";
const CREAM = "#f7f4ed";
const PINK = "#ff0a8a";
const YELLOW = "#ffc900";

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

function LogoMark({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b-2 px-3 py-2 ${dark ? "border-white/20 bg-[#11192d]" : "border-[#11192d] bg-[#f7f4ed]"}`}>
      <img alt="The Adventure Zone" className="h-8 w-auto object-contain" src={LOGO_SRC} />
      <div className={`h-7 w-7 border-2 p-1 ${dark ? "border-white bg-[#ffc900]" : "border-[#11192d] bg-[#ffc900]"}`}>
        <span className="block h-0.5 bg-[#11192d]" /><span className="mt-1 block h-0.5 bg-[#11192d]" /><span className="mt-1 block h-0.5 bg-[#11192d]" />
      </div>
    </div>
  );
}

function GridBackground({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        backgroundColor: CREAM,
        backgroundImage:
          "linear-gradient(rgba(17,25,45,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(17,25,45,.09) 1px, transparent 1px)",
        backgroundSize: "15px 15px",
      }}
    >
      {children}
    </div>
  );
}

function TemplatePreview({ starter }: { starter: CanvaStarter }) {
  if (starter.id === "event-flyer") {
    return (
      <div className="mx-auto aspect-[8.5/11] w-48 overflow-hidden bg-[#f7f4ed] shadow-2xl ring-1 ring-black/15">
        <LogoMark />
        <div className="relative h-20 overflow-hidden bg-[#27334b]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(255,201,0,.28),transparent_35%),radial-gradient(circle_at_85%_60%,rgba(255,10,138,.25),transparent_38%)]" />
          <div className="absolute left-3 top-2 -rotate-3 border-2 border-[#11192d] bg-[#ff0a8a] px-2 py-1 text-[5px] font-black tracking-[0.16em] text-white shadow-[3px_3px_0_#11192d]">★ AMERICA'S BEST BOUNCE HOUSE CARNIVAL! ★</div>
          <div className="absolute bottom-2 left-3 right-3">
            <p className="text-[16px] font-black leading-[.82] text-white">WE BRING</p>
            <p className="text-[19px] font-black leading-[.82] text-[#ffc900]">THE ACTION</p>
          </div>
        </div>
        <GridBackground className="min-h-[160px] px-3 py-3">
          <p className="text-[12px] font-black leading-none text-[#11192d]">[EVENT NAME]</p>
          <p className="mt-1 text-[6px] font-black uppercase tracking-wide text-[#ff0a8a]">[DATE] • [TIME] • [CITY, STATE]</p>
          <div className="mt-3 border-2 border-[#11192d] bg-white p-2 shadow-[3px_3px_0_#11192d]">
            <p className="text-[6px] font-black text-[#11192d]">10 PREMIUM ATTRACTIONS</p>
            <p className="mt-1 text-[5px] leading-tight text-slate-600">Giant slides • obstacle courses • bounces • interactive games</p>
          </div>
          <div className="mt-3 flex gap-2">
            <div className="flex-1 border-2 border-[#11192d] bg-[#ffc900] p-2 text-[6px] font-black text-[#11192d] shadow-[3px_3px_0_#11192d]">[ADMISSION / TICKETS]</div>
            <div className="border-2 border-[#11192d] bg-[#ff0a8a] p-2 text-[6px] font-black text-white shadow-[3px_3px_0_#11192d]">SEE YOU THERE →</div>
          </div>
        </GridBackground>
      </div>
    );
  }

  if (starter.id === "social-post") {
    return (
      <div className="relative mx-auto aspect-[4/5] w-48 overflow-hidden bg-[#11192d] shadow-2xl ring-1 ring-black/15">
        <LogoMark dark />
        <div className="relative h-[210px] overflow-hidden px-4 py-4 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,201,0,.24),transparent_28%),radial-gradient(circle_at_78%_55%,rgba(255,10,138,.34),transparent_36%),linear-gradient(145deg,#27334b,#11192d_70%)]" />
          <div className="relative inline-block -rotate-2 border-2 border-[#11192d] bg-[#ff0a8a] px-2 py-1 text-[5px] font-black tracking-[0.16em] shadow-[3px_3px_0_#ffc900]">★ WE BRING THE ACTION ★</div>
          <p className="relative mt-5 text-[24px] font-black leading-[.82]">BIG DAY.</p>
          <p className="relative text-[24px] font-black leading-[.82] text-[#ffc900]">BIG FUN.</p>
          <div className="relative mt-5 border-t border-[#ff0a8a] pt-3 text-[7px] font-bold leading-snug">[EVENT NAME]<br /><span className="text-white/70">[DATE] • [CITY, STATE]</span></div>
          <div className="relative mt-4 inline-block border-2 border-white px-3 py-2 text-[6px] font-black shadow-[3px_3px_0_#ff0a8a]">BRING THE WHOLE CREW →</div>
        </div>
      </div>
    );
  }

  if (starter.id === "last-minute-booking") {
    return (
      <div className="mx-auto aspect-[4/5] w-48 overflow-hidden bg-[#f7f4ed] shadow-2xl ring-1 ring-black/15">
        <LogoMark />
        <GridBackground className="min-h-[210px] p-3">
          <div className="inline-block border-2 border-[#11192d] bg-[#ff0a8a] px-2 py-1 text-[5px] font-black tracking-[0.14em] text-white shadow-[3px_3px_0_#11192d]">OPEN DATE ALERT</div>
          <p className="mt-4 text-[20px] font-black leading-[.85] text-[#11192d]">FILL THE GAP.</p>
          <p className="text-[20px] font-black leading-[.85] text-[#ff0a8a]">BRING THE FUN.</p>
          <p className="mt-3 text-[6px] font-bold text-slate-600">Opening near [REGION / ROUTE]</p>
          <div className="mt-2 border-2 border-[#11192d] bg-[#ffc900] p-2 shadow-[3px_3px_0_#11192d]">
            <p className="text-[5px] font-black uppercase tracking-wider">AVAILABLE DATE</p>
            <p className="text-[11px] font-black">[DATE]</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="border-2 border-[#11192d] bg-white p-2 text-[5px] font-bold shadow-[2px_2px_0_#11192d]">✓ SETUP<br />✓ STAFFING</div>
            <div className="border-2 border-[#11192d] bg-white p-2 text-[5px] font-bold shadow-[2px_2px_0_#11192d]">✓ INSURED<br />✓ TURNKEY</div>
          </div>
          <div className="mt-3 border-2 border-[#11192d] bg-[#ff0a8a] px-3 py-2 text-center text-[6px] font-black text-white shadow-[3px_3px_0_#11192d]">LET'S TALK DATES • (435) 760-5583</div>
        </GridBackground>
      </div>
    );
  }

  if (starter.id === "package-overview") {
    return (
      <div className="mx-auto aspect-[8.5/11] w-48 overflow-hidden bg-[#11192d] shadow-2xl ring-1 ring-black/15">
        <LogoMark dark />
        <div className="px-3 py-3 text-white">
          <div className="flex items-center justify-center gap-2 text-[5px] font-black tracking-[0.18em] text-[#ffc900]"><span className="h-0.5 w-6 bg-[#ffc900]" />THE FLEET<span className="h-0.5 w-6 bg-[#ffc900]" /></div>
          <p className="mt-1 text-center text-[17px] font-black">EPIC PACKAGES</p>
          <p className="mt-1 text-center text-[5px] text-white/65">Fully staffed for 1–4 days.</p>
          <div className="mt-3 border-2 border-white bg-[#f7f4ed] text-[#11192d] shadow-[3px_3px_0_#ffc900]">
            <div className="h-8 bg-[linear-gradient(135deg,#ff0a8a,#ffc900)] opacity-80" />
            <div className="p-2"><p className="text-[7px] font-black">★ ADVENTURE ZONE</p><p className="mt-1 text-[5px]">10 premium attractions • giant slides • obstacles</p><p className="mt-1 text-[8px] font-black">$9,000 <span className="text-[5px]">/ 1–4 DAYS</span></p></div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="border-2 border-white bg-[#f7f4ed] p-2 text-[#11192d] shadow-[2px_2px_0_#ff0a8a]"><p className="text-[6px] font-black">⚓ PIRATE'S REBELLION</p><p className="mt-1 text-[5px]">Water & pirate themed fun</p><p className="mt-2 text-[8px] font-black">$7,500</p></div>
            <div className="border-2 border-white bg-[#f7f4ed] p-2 text-[#11192d] shadow-[2px_2px_0_#ffc900]"><p className="text-[6px] font-black">◎ WARRIOR'S PLAYGROUND</p><p className="mt-1 text-[5px]">Paintball • AirSoft • Orbeez</p><p className="mt-2 text-[8px] font-black">$7,500</p></div>
          </div>
          <div className="mt-2 border border-[#ffc900] p-2 text-center text-[4.5px] font-bold text-[#ffc900]">SETUP • STAFFING • $2M INSURANCE • TEARDOWN</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto aspect-square w-48 overflow-hidden bg-[#f7f4ed] shadow-2xl ring-1 ring-black/15">
      <LogoMark />
      <GridBackground className="relative min-h-[160px] p-4 text-center">
        <div className="mx-auto flex h-8 w-8 items-center justify-center border-2 border-[#11192d] bg-[#ffc900] text-[13px] shadow-[3px_3px_0_#11192d]">★</div>
        <div className="mt-3 inline-block bg-[#ff0a8a] px-2 py-1 text-[5px] font-black tracking-[0.14em] text-white">THANKS FOR THE BIG DAY!</div>
        <p className="mt-3 text-[19px] font-black leading-[.9] text-[#11192d]">HOW DID<br />WE DO?</p>
        <p className="mt-2 text-[9px] tracking-[.22em] text-[#ff0a8a]">★★★★★</p>
        <div className="mx-auto mt-3 h-11 w-11 border-2 border-[#11192d] bg-white p-1 shadow-[3px_3px_0_#11192d]"><div className="h-full w-full bg-[repeating-linear-gradient(45deg,#11192d_0_2px,transparent_2px_4px)] opacity-70" /></div>
        <div className="mt-3 border-2 border-[#11192d] bg-[#ffc900] px-2 py-2 text-[5px] font-black text-[#11192d] shadow-[3px_3px_0_#11192d]">SHARE YOUR EXPERIENCE →</div>
      </GridBackground>
    </div>
  );
}

function StarterCard({ starter, creating, onUse }: { starter: CanvaStarter; creating: boolean; onUse: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex min-h-72 items-center justify-center border-b bg-[radial-gradient(circle_at_top,_hsl(var(--muted)),_transparent_70%)] p-5">
        <TemplatePreview starter={starter} />
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="gap-1.5 capitalize">{typeIcon[starter.type] ?? <Sparkles className="h-4 w-4" />}{starter.type}</Badge>
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
          <div className="text-center"><FolderOpen className="mx-auto h-6 w-6 text-primary" /><p className="mt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Canva project</p></div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="truncate font-bold text-foreground">{project.name}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(project.updatedAt)}</p></div>
          <Badge variant="outline" className="shrink-0 capitalize">{status}</Badge>
        </div>
      </Link>
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <AlertDialog>
          <AlertDialogTrigger asChild><Button className="gap-1.5 text-destructive" disabled={deleting} size="sm" variant="ghost">{deleting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle><AlertDialogDescription>This removes the design from your active Design Studio. This cannot be undone from this screen.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={onDelete}>Delete design</AlertDialogAction></AlertDialogFooter>
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
      const project = await designStudioApi.create({ type: starter.type, name: starter.name, content: starter.content, notes: `CANVA_STARTER_ID=${starter.id}` });
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
          <div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em]"><Sparkles className="h-3.5 w-3.5 text-accent" />Design Studio + Canva Free</div>
          <h1 className="mt-5 text-3xl font-black tracking-tight md:text-5xl">Adventure Zone looks. Canva editing.</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-sidebar-foreground/70">The starter designs now follow the same visual system as the website: deep navy, warm cream, yellow, hot pink, heavy outlines, offset shadows, grid texture, oversized type, and the Adventure Zone logo.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="gap-2" onClick={() => document.getElementById("starter-templates")?.scrollIntoView({ behavior: "smooth" })}><Sparkles className="h-4 w-4" />Choose a starter</Button>
            <Button className="gap-2 border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent" variant="outline" onClick={() => window.open(CANVA_CREATE_URL, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" />Open Canva Free</Button>
          </div>
        </div>
      </header>

      {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert"><span className="text-destructive">{error}</span><Button onClick={() => void loadProjects()} size="sm" variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div> : null}

      <section id="starter-templates" aria-labelledby="starter-heading">
        <div className="mb-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Built for Adventure Zone</p><h2 className="mt-1 text-2xl font-black tracking-tight" id="starter-heading">Website-matched starter templates</h2><p className="mt-1 text-sm text-muted-foreground">These previews now use the same branding language as the site you showed me, including the actual Adventure Zone logo.</p></div>
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
