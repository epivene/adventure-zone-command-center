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

const PHOTOS = {
  polarBear: "https://static.wixstatic.com/media/81786c_03c4528320c64347805d5ecfb2d15fc6~mv2.jpg/v1/fill/w_700,h_700,al_c,q_85/81786c_03c4528320c64347805d5ecfb2d15fc6~mv2.jpg",
  joust: "https://static.wixstatic.com/media/81786c_53777ae5a685418aa8b0f2d2cc1a3389~mv2.jpg/v1/fill/w_960,h_638,al_c,q_85/81786c_53777ae5a685418aa8b0f2d2cc1a3389~mv2.jpg",
  obstacle: "https://static.wixstatic.com/media/81786c_41e3ae81e9f7495f82d6f7a40a8624ec~mv2.png/v1/fill/w_600,h_530,al_c,q_85/81786c_41e3ae81e9f7495f82d6f7a40a8624ec~mv2.png",
  pirate: "https://static.wixstatic.com/media/81786c_b76e99322ab349f582e890f5b18248a3~mv2.png/v1/fill/w_980,h_524,al_c,q_90/81786c_b76e99322ab349f582e890f5b18248a3~mv2.png",
  water: "https://static.wixstatic.com/media/81786c_badfcecb67e04dfdac46e86aeb86dd72~mv2.png/v1/fill/w_980,h_653,al_c,q_90/81786c_badfcecb67e04dfdac46e86aeb86dd72~mv2.png",
  pirateCombo: "https://static.wixstatic.com/media/81786c_9f98479bedc14a7a9036318fa0d93792~mv2.png/v1/fill/w_647,h_378,al_c,q_85/81786c_9f98479bedc14a7a9036318fa0d93792~mv2.png",
} as const;

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

function PhotoFrame({ src, className = "", rotate = "" }: { src: string; className?: string; rotate?: string }) {
  return (
    <div className={`overflow-hidden border-[3px] border-white bg-white shadow-[4px_4px_0_#111] ${rotate} ${className}`}>
      <img alt="Adventure Zone attraction" className="h-full w-full object-cover" src={src} />
    </div>
  );
}

function Brush({ children, tone = "pink", className = "" }: { children: React.ReactNode; tone?: "pink" | "yellow" | "black"; className?: string }) {
  const tones = {
    pink: "bg-[#ef1763] text-white",
    yellow: "bg-[#ffd21a] text-[#111]",
    black: "bg-black text-white",
  };
  return <div className={`skew-x-[-3deg] px-2 py-1 font-black uppercase tracking-wide ${tones[tone]} ${className}`}>{children}</div>;
}

function Bubble({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[45%] border-[3px] border-black bg-white px-3 py-2 text-center font-black text-black shadow-[3px_3px_0_#111] ${className}`}>{children}</div>;
}

function EventFlyerPreview() {
  return (
    <div className="relative mx-auto aspect-[8.5/11] w-52 overflow-hidden bg-black shadow-2xl ring-1 ring-black/20">
      <div className="relative h-[70px] px-3 pt-2">
        <div className="absolute left-3 top-2 h-12 w-28 rotate-[-3deg] bg-[#ef1763] opacity-95" />
        <img alt="The Adventure Zone" className="relative z-10 h-14 w-auto object-contain" src={LOGO_SRC} />
        <span className="absolute right-4 top-2 text-xl text-[#ffd21a]">★</span>
        <span className="absolute right-10 top-11 text-sm text-[#ffd21a]">★</span>
      </div>
      <p className="px-3 text-center text-[7px] font-black uppercase italic tracking-wide text-white">America's Best Inflatable Carnival!</p>
      <div className="relative mt-2 h-[98px]">
        <PhotoFrame className="absolute left-2 top-1 h-[82px] w-[132px]" rotate="rotate-[-2deg]" src={PHOTOS.polarBear} />
        <PhotoFrame className="absolute bottom-0 right-2 h-[55px] w-[76px]" rotate="rotate-[2deg]" src={PHOTOS.joust} />
        <Bubble className="absolute -left-1 top-0 z-20 text-[6px] leading-tight">$25/HOUR<br /><span className="text-[#ef1763]">$30 ALL DAY</span><br />ADULTS FREE</Bubble>
      </div>
      <div className="absolute right-2 top-[72px] w-[76px] rotate-[1deg]">
        <Brush tone="yellow" className="text-center text-[6px] leading-tight">PART OF THE<br /><span className="text-[#ef1763]">[EVENT NAME]</span></Brush>
        <Brush className="mt-2 text-center text-[7px] leading-tight">COME PLAY<br /><span className="text-[#ffd21a]">JUST MINUTES AWAY!</span></Brush>
      </div>
      <div className="absolute bottom-[68px] left-2 w-[118px] rotate-[-1deg] bg-[#fff4f7] p-2 shadow-[3px_3px_0_#111]">
        <Brush className="text-[6px]">★ RIGHT DOWN THE ROAD!</Brush>
        <p className="mt-2 text-center text-[6px] font-black italic">A SHORT DRIVE FOR<br />BIG TIME FUN!</p>
        <div className="mt-2 flex items-center justify-center gap-2 text-[10px]">📍 <span>→</span> 🎪</div>
      </div>
      <div className="absolute bottom-[67px] right-2 w-[82px] bg-black p-2 text-white">
        <p className="text-[7px] font-black italic text-[#ef1763]">SO MUCH TO ENJOY!</p>
        <p className="mt-2 text-[5px] font-bold">🎪 AWESOME INFLATABLES</p>
        <p className="mt-1 text-[5px] font-bold">👥 FUN FOR ALL AGES</p>
        <p className="mt-1 text-[5px] font-bold">✓ SAFE. CLEAN. ON TIME.</p>
      </div>
      <Brush tone="yellow" className="absolute bottom-[38px] left-2 right-2 text-center text-[7px] italic">★ BRING THE WHOLE FAMILY & MAKE MEMORIES! ★</Brush>
      <div className="absolute bottom-0 left-0 right-0 bg-[#d81b58] px-2 py-2 text-center text-[6px] font-bold text-white">[DATE] • [TIME] • [LOCATION]</div>
    </div>
  );
}

function SocialPreview() {
  return (
    <div className="relative mx-auto aspect-[4/5] w-52 overflow-hidden bg-black shadow-2xl ring-1 ring-black/20">
      <PhotoFrame className="absolute inset-x-2 top-2 h-[155px]" rotate="rotate-[-1deg]" src={PHOTOS.joust} />
      <div className="absolute inset-x-0 top-0 h-[105px] bg-gradient-to-b from-black/65 to-transparent" />
      <img alt="The Adventure Zone" className="absolute left-3 top-3 z-10 h-12 w-auto" src={LOGO_SRC} />
      <span className="absolute right-4 top-3 z-10 text-2xl text-[#ffd21a]">★</span>
      <Brush className="absolute left-3 top-[116px] z-20 text-[7px]">WE BRING THE ACTION</Brush>
      <Brush tone="yellow" className="absolute right-2 top-[148px] z-20 text-[8px]">[EVENT NAME]</Brush>
      <div className="absolute bottom-[66px] left-3 right-3 -rotate-1 bg-[#ef1763] p-3 text-white shadow-[4px_4px_0_#ffd21a]">
        <p className="text-[18px] font-black leading-[.8]">BIG DAY.</p>
        <p className="text-[18px] font-black leading-[.8] text-[#ffd21a]">BIG FUN.</p>
        <p className="mt-3 text-[6px] font-bold">[DATE] • [CITY, STATE]</p>
      </div>
      <Bubble className="absolute -left-1 bottom-2 text-[6px]">SLIDES<br />GAMES<br />CHALLENGES</Bubble>
      <Brush tone="yellow" className="absolute bottom-3 right-2 text-[6px]">BRING THE WHOLE CREW →</Brush>
    </div>
  );
}

function LastMinutePreview() {
  return (
    <div className="relative mx-auto aspect-[4/5] w-52 overflow-hidden bg-[#ffd21a] shadow-2xl ring-1 ring-black/20">
      <PhotoFrame className="absolute left-3 right-3 top-3 h-[108px]" rotate="rotate-[1deg]" src={PHOTOS.polarBear} />
      <Brush className="absolute left-2 top-2 z-10 text-[7px]">OPEN DATE ALERT!</Brush>
      <Bubble className="absolute right-0 top-[82px] z-20 text-[7px] leading-tight">[DATE]<br /><span className="text-[#ef1763]">AVAILABLE!</span></Bubble>
      <div className="absolute inset-x-3 top-[126px] bg-black p-3 text-white shadow-[4px_4px_0_#ef1763]">
        <p className="text-[17px] font-black leading-[.85]">FILL THE GAP.</p>
        <p className="text-[17px] font-black leading-[.85] text-[#ef1763]">BRING THE FUN.</p>
        <p className="mt-2 text-[6px] font-bold">Opening near [REGION / ROUTE]</p>
      </div>
      <PhotoFrame className="absolute bottom-[55px] left-3 h-[62px] w-[94px]" rotate="rotate-[-2deg]" src={PHOTOS.obstacle} />
      <div className="absolute bottom-[52px] right-3 w-[86px] bg-[#fff4f7] p-2 shadow-[3px_3px_0_#111]">
        <p className="text-[6px] font-black">✓ SETUP</p><p className="text-[6px] font-black">✓ STAFFING</p><p className="text-[6px] font-black">✓ INSURED</p><p className="text-[6px] font-black">✓ TURNKEY</p>
      </div>
      <Brush className="absolute bottom-2 left-2 right-2 text-center text-[7px]">LET'S TALK DATES • (435) 760-5583</Brush>
    </div>
  );
}

function PackagesPreview() {
  return (
    <div className="relative mx-auto aspect-[8.5/11] w-52 overflow-hidden bg-black shadow-2xl ring-1 ring-black/20">
      <div className="flex items-start justify-between px-3 pt-2">
        <img alt="The Adventure Zone" className="h-12 w-auto" src={LOGO_SRC} />
        <span className="text-2xl text-[#ffd21a]">★</span>
      </div>
      <Brush tone="yellow" className="mx-3 mt-1 text-center text-[8px]">EPIC PACKAGES</Brush>
      <PhotoFrame className="mx-3 mt-2 h-[72px]" src={PHOTOS.polarBear} />
      <div className="mx-3 bg-white p-2 shadow-[3px_3px_0_#ef1763]">
        <p className="text-[7px] font-black">★ ADVENTURE ZONE</p><p className="text-[5px]">10 attractions • slides • obstacles • games</p><p className="mt-1 text-[9px] font-black text-[#ef1763]">$9,000</p>
      </div>
      <div className="mx-3 mt-2 grid grid-cols-2 gap-2">
        <div className="bg-white p-1.5 shadow-[3px_3px_0_#ffd21a]"><img alt="Pirate's Rebellion" className="h-10 w-full object-cover" src={PHOTOS.pirate} /><p className="mt-1 text-[5px] font-black">⚓ PIRATE'S REBELLION</p><p className="text-[8px] font-black text-[#ef1763]">$7,500</p></div>
        <div className="bg-white p-1.5 shadow-[3px_3px_0_#ef1763]"><img alt="Warrior's Playground" className="h-10 w-full object-cover" src={PHOTOS.joust} /><p className="mt-1 text-[5px] font-black">◎ WARRIOR'S PLAYGROUND</p><p className="text-[8px] font-black text-[#ef1763]">$7,500</p></div>
      </div>
      <Brush className="absolute bottom-3 left-3 right-3 text-center text-[6px]">SETUP • STAFFING • $2M INSURANCE • TEARDOWN</Brush>
    </div>
  );
}

function ReviewPreview() {
  return (
    <div className="relative mx-auto aspect-square w-52 overflow-hidden bg-black shadow-2xl ring-1 ring-black/20">
      <PhotoFrame className="absolute left-2 right-2 top-2 h-[86px]" rotate="rotate-[-1deg]" src={PHOTOS.water} />
      <img alt="The Adventure Zone" className="absolute left-3 top-3 z-10 h-10 w-auto" src={LOGO_SRC} />
      <Brush tone="yellow" className="absolute right-2 top-[68px] z-10 text-[6px]">THANKS FOR THE BIG DAY!</Brush>
      <div className="absolute inset-x-3 top-[100px] -rotate-1 bg-[#ef1763] p-3 text-center text-white shadow-[4px_4px_0_#ffd21a]">
        <p className="text-[18px] font-black leading-none">HOW'D WE DO?</p>
        <p className="mt-2 text-[10px] tracking-[.18em] text-[#ffd21a]">★★★★★</p>
      </div>
      <Bubble className="absolute bottom-[25px] left-3 text-[6px]">SCAN<br />TO REVIEW</Bubble>
      <PhotoFrame className="absolute bottom-4 right-3 h-[58px] w-[92px]" rotate="rotate-[2deg]" src={PHOTOS.pirateCombo} />
      <span className="absolute bottom-1 right-2 text-lg text-[#ffd21a]">★</span>
    </div>
  );
}

function TemplatePreview({ starter }: { starter: CanvaStarter }) {
  if (starter.id === "event-flyer") return <EventFlyerPreview />;
  if (starter.id === "social-post") return <SocialPreview />;
  if (starter.id === "last-minute-booking") return <LastMinutePreview />;
  if (starter.id === "package-overview") return <PackagesPreview />;
  return <ReviewPreview />;
}

function StarterCard({ starter, creating, onUse }: { starter: CanvaStarter; creating: boolean; onUse: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex min-h-80 items-center justify-center border-b bg-muted/20 p-5"><TemplatePreview starter={starter} /></div>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3"><Badge variant="secondary" className="gap-1.5 capitalize">{typeIcon[starter.type] ?? <Sparkles className="h-4 w-4" />}{starter.type}</Badge><span className="text-xs font-semibold text-muted-foreground">{starter.canvasSize}</span></div>
        <h3 className="mt-3 font-black text-foreground">{starter.name}</h3>
        <p className="mt-1.5 min-h-10 text-sm leading-relaxed text-muted-foreground">{starter.description}</p>
        <Button className="mt-4 w-full gap-2" disabled={creating} onClick={onUse}>{creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{creating ? "Creating…" : "Use this design"}</Button>
      </div>
    </article>
  );
}

function ProjectCard({ project, deleting, onDelete }: { project: DesignProject; deleting: boolean; onDelete: () => void }) {
  const status = project.status ?? "draft";
  return (
    <article className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
      <Link className="block" href={`/design-studio/${project.id}`}>
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30"><div className="text-center"><FolderOpen className="mx-auto h-6 w-6 text-primary" /><p className="mt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Canva project</p></div></div>
        <div className="mt-3 flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-bold text-foreground">{project.name}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(project.updatedAt)}</p></div><Badge variant="outline" className="shrink-0 capitalize">{status}</Badge></div>
      </Link>
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <AlertDialog>
          <AlertDialogTrigger asChild><Button className="gap-1.5 text-destructive" disabled={deleting} size="sm" variant="ghost">{deleting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete</Button></AlertDialogTrigger>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle><AlertDialogDescription>This removes the design from your active Design Studio. This cannot be undone from this screen.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={onDelete}>Delete design</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
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
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" /><div className="pointer-events-none absolute -bottom-20 left-24 h-60 w-60 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative max-w-3xl"><div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em]"><Sparkles className="h-3.5 w-3.5 text-accent" />Design Studio + Canva Free</div><h1 className="mt-5 text-3xl font-black tracking-tight md:text-5xl">Fun first. Canva second.</h1><p className="mt-3 max-w-2xl text-base leading-relaxed text-sidebar-foreground/70">These starters use real Adventure Zone attraction photography and the loud scrapbook-carnival style from your favorite Meeteetse flyer: brush blocks, crooked photo frames, bubbles, stars, stickers, and big event information.</p><div className="mt-6 flex flex-wrap gap-3"><Button className="gap-2" onClick={() => document.getElementById("starter-templates")?.scrollIntoView({ behavior: "smooth" })}><Sparkles className="h-4 w-4" />Choose a starter</Button><Button className="gap-2 border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent" variant="outline" onClick={() => window.open(CANVA_CREATE_URL, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" />Open Canva Free</Button></div></div>
      </header>

      {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert"><span className="text-destructive">{error}</span><Button onClick={() => void loadProjects()} size="sm" variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div> : null}

      <section id="starter-templates" aria-labelledby="starter-heading"><div className="mb-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Built for Adventure Zone</p><h2 className="mt-1 text-2xl font-black tracking-tight" id="starter-heading">Fun, photo-heavy starter templates</h2><p className="mt-1 text-sm text-muted-foreground">These are visual designs first — not text prompts wearing a template costume.</p></div><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{CANVA_STARTERS.map((starter) => <StarterCard key={starter.id} starter={starter} creating={creatingId === starter.id} onUse={() => void useStarter(starter)} />)}</div></section>

      <section><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Saved work</p><h2 className="mt-1 text-2xl font-black tracking-tight">My designs</h2><p className="mt-1 text-sm text-muted-foreground">Open a design to work with it, or delete old designs you no longer want in the Studio.</p></div><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search designs" value={search} /></div></div>{loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-40 rounded-xl" />)}</div> : visibleProjects.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleProjects.map((project) => <ProjectCard key={project.id} project={project} deleting={deletingId === project.id} onDelete={() => void deleteProject(project)} />)}</div> : <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center"><FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-bold">No matching designs yet.</p><p className="mt-1 text-sm text-muted-foreground">Pick one of the visual starters above and it will show up here.</p></div>}</section>
    </div>
  );
}
