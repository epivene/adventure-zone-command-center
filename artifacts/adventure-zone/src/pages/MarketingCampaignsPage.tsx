import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Mail, Megaphone, Plus, Search, Trash2, UsersRound } from "lucide-react";
import { Link, useSearch } from "wouter";

import { apiGet } from "@/lib/auth-token";

type Area = "email" | "promos" | "audiences" | "history";
type AudienceMember = { id: string; name: string; email: string };
type SmartAudience = {
  id: string;
  kind: "smart";
  name: string;
  q: string;
  region: string;
  placeType: string;
  estimatedCount: number;
  createdAt: string;
};
type ManualAudience = {
  id: string;
  kind: "manual";
  name: string;
  q: "";
  region: "";
  placeType: "";
  estimatedCount: number;
  profileIds: string[];
  profiles: AudienceMember[];
  createdAt: string;
};
type Audience = SmartAudience | ManualAudience;
type Promo = { id: string; title: string; kind: string; notes: string; createdAt: string };
type Campaign = { id: string; name: string; subject: string; body: string; audienceId: string | null; audienceName: string; recipientCount: number; status: "draft" | "sent"; createdAt: string; sentAt: string | null };
type MarketingState = { audiences: Audience[]; promos: Promo[]; campaigns: Campaign[] };
type OrganizationRecord = { id: string; name: string; email?: string | null; city?: string | null; region?: string | null; placeType?: string | null };
type OrganizationListPage = { total: number; records?: OrganizationRecord[] };

const STORAGE_KEY = "adventure-zone-marketing-campaigns-v1";
const emptyState: MarketingState = { audiences: [], promos: [], campaigns: [] };

function normalizeAudience(value: any): Audience | null {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.name !== "string") return null;
  if (value.kind === "manual") {
    const profiles = Array.isArray(value.profiles)
      ? value.profiles.filter((item: any) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.email === "string" && item.email.trim())
      : [];
    const profileIds = Array.isArray(value.profileIds) ? value.profileIds.filter((id: unknown): id is string => typeof id === "string") : profiles.map((item: AudienceMember) => item.id);
    return {
      id: value.id,
      kind: "manual",
      name: value.name,
      q: "",
      region: "",
      placeType: "",
      estimatedCount: profileIds.length,
      profileIds,
      profiles,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    };
  }
  return {
    id: value.id,
    kind: "smart",
    name: value.name,
    q: typeof value.q === "string" ? value.q : "",
    region: typeof value.region === "string" ? value.region : "",
    placeType: typeof value.placeType === "string" ? value.placeType : "",
    estimatedCount: typeof value.estimatedCount === "number" ? value.estimatedCount : 0,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
  };
}

function readState(): MarketingState {
  if (typeof window === "undefined") return emptyState;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || !Array.isArray(parsed.audiences) || !Array.isArray(parsed.promos) || !Array.isArray(parsed.campaigns)) return emptyState;
    return { ...parsed, audiences: parsed.audiences.map(normalizeAudience).filter((item: Audience | null): item is Audience => Boolean(item)) };
  } catch {
    return emptyState;
  }
}

function areaFromSearch(search: string): Area {
  const value = new URLSearchParams(search).get("area");
  return value === "promos" || value === "audiences" || value === "history" ? value : "email";
}

function audienceHref(audience: SmartAudience) {
  const params = new URLSearchParams();
  if (audience.q) params.set("q", audience.q);
  if (audience.region) params.set("region", audience.region);
  if (audience.placeType) params.set("type", audience.placeType);
  params.set("hasEmail", "yes");
  return `/profiles?${params.toString()}`;
}

function audienceRecipientCount(item: Audience) {
  return item.kind === "manual" ? item.profileIds.length : item.estimatedCount;
}

export default function MarketingCampaignsPage() {
  const search = useSearch();
  const area = areaFromSearch(search);
  const [state, setState] = useState<MarketingState>(() => readState());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const tabs = [
    ["email", "Email campaigns", Mail],
    ["promos", "Brochures & promos", FileText],
    ["audiences", "Audiences & lists", UsersRound],
    ["history", "Campaign history", Megaphone],
  ] as const;

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground" href="/marketing"><ArrowLeft className="h-4 w-4" />Marketing</Link>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Build reusable audiences, keep promo material organized, prepare email campaign drafts, and keep a record of what was sent.</p>
        </div>
      </header>

      <nav aria-label="Campaign sections" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tabs.map(([key, label, Icon]) => (
          <Link className={`flex items-center gap-2 rounded-xl border p-3 font-semibold transition-colors ${area === key ? "border-primary bg-primary/5 text-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`} href={`/marketing?area=${key}`} key={key}>
            <Icon className="h-4 w-4" />{label}
          </Link>
        ))}
      </nav>

      {notice ? <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div> : null}

      {area === "email" ? <EmailCampaigns state={state} setState={setState} setNotice={setNotice} /> : null}
      {area === "promos" ? <Promos state={state} setState={setState} setNotice={setNotice} /> : null}
      {area === "audiences" ? <Audiences state={state} setState={setState} setNotice={setNotice} /> : null}
      {area === "history" ? <History state={state} setState={setState} /> : null}
    </div>
  );
}

function Audiences({ state, setState, setNotice }: { state: MarketingState; setState: React.Dispatch<React.SetStateAction<MarketingState>>; setNotice: (value: string | null) => void }) {
  const [mode, setMode] = useState<"smart" | "manual">("smart");
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [placeType, setPlaceType] = useState("");
  const [saving, setSaving] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualResults, setManualResults] = useState<AudienceMember[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<AudienceMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function addSmartAudience() {
    if (!name.trim() || saving) return;
    setSaving(true);
    const params = new URLSearchParams({ hasEmail: "yes", pageSize: "1" });
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (placeType.trim()) params.set("type", placeType.trim());
    let estimatedCount = 0;
    try { estimatedCount = (await apiGet<OrganizationListPage>(`/organizations?${params.toString()}`)).total ?? 0; } catch { estimatedCount = 0; }
    const item: SmartAudience = { id: crypto.randomUUID(), kind: "smart", name: name.trim(), q: q.trim(), region: region.trim(), placeType: placeType.trim(), estimatedCount, createdAt: new Date().toISOString() };
    setState((current) => ({ ...current, audiences: [item, ...current.audiences] }));
    setName(""); setQ(""); setRegion(""); setPlaceType(""); setSaving(false); setNotice(`Saved smart list “${item.name}” with about ${estimatedCount} email-ready profiles.`);
  }

  async function searchManualProfiles() {
    setSearching(true);
    const params = new URLSearchParams({ hasEmail: "yes", pageSize: "50" });
    if (manualSearch.trim()) params.set("q", manualSearch.trim());
    try {
      const response = await apiGet<OrganizationListPage>(`/organizations?${params.toString()}`);
      const results = (response.records ?? [])
        .filter((profile) => typeof profile.email === "string" && profile.email.trim())
        .map((profile) => ({ id: profile.id, name: profile.name, email: profile.email!.trim() }));
      setManualResults(results);
    } catch {
      setManualResults([]);
      setNotice("Could not load email-ready profiles. Try the search again.");
    } finally {
      setSearching(false);
    }
  }

  function toggleManualProfile(profile: AudienceMember) {
    setSelectedProfiles((current) => current.some((item) => item.id === profile.id) ? current.filter((item) => item.id !== profile.id) : [...current, profile]);
  }

  function saveManualAudience() {
    if (!name.trim() || selectedProfiles.length === 0) return;
    const profileIds = selectedProfiles.map((profile) => profile.id);
    if (editingId) {
      setState((current) => ({
        ...current,
        audiences: current.audiences.map((item) => item.id === editingId ? {
          id: item.id,
          kind: "manual",
          name: name.trim(),
          q: "",
          region: "",
          placeType: "",
          estimatedCount: profileIds.length,
          profileIds,
          profiles: selectedProfiles,
          createdAt: item.createdAt,
        } : item),
      }));
      setNotice(`Updated manual list “${name.trim()}” with ${profileIds.length} email-ready profiles.`);
    } else {
      const item: ManualAudience = { id: crypto.randomUUID(), kind: "manual", name: name.trim(), q: "", region: "", placeType: "", estimatedCount: profileIds.length, profileIds, profiles: selectedProfiles, createdAt: new Date().toISOString() };
      setState((current) => ({ ...current, audiences: [item, ...current.audiences] }));
      setNotice(`Saved manual list “${item.name}” with ${profileIds.length} email-ready profiles.`);
    }
    resetManualForm();
  }

  function resetManualForm() {
    setName("");
    setManualSearch("");
    setManualResults([]);
    setSelectedProfiles([]);
    setEditingId(null);
  }

  function editManualAudience(audience: ManualAudience) {
    setMode("manual");
    setEditingId(audience.id);
    setName(audience.name);
    setSelectedProfiles(audience.profiles);
    setManualResults([]);
    setManualSearch("");
  }

  return <section className="grid gap-4">
    <div className="flex flex-wrap gap-2">
      <button className={mode === "smart" ? "button-primary" : "button-secondary"} onClick={() => { setMode("smart"); resetManualForm(); }}>Smart list</button>
      <button className={mode === "manual" ? "button-primary" : "button-secondary"} onClick={() => { setMode("manual"); setName(""); }}>Manual list</button>
    </div>

    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      {mode === "smart" ? <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-bold">Create smart list</h2>
        <p className="mt-1 text-sm text-muted-foreground">Build a reusable list from Booking profile filters. Only profiles with an email address are counted.</p>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">List name<input value={name} onChange={(e)=>setName(e.target.value)} placeholder="2027 county fairs" /></label>
          <label className="grid gap-1 text-sm font-semibold">Search words<input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="fair, festival…" /></label>
          <label className="grid gap-1 text-sm font-semibold">Region<input value={region} onChange={(e)=>setRegion(e.target.value)} placeholder="UT, ND, OR…" /></label>
          <label className="grid gap-1 text-sm font-semibold">Profile type<input value={placeType} onChange={(e)=>setPlaceType(e.target.value)} placeholder="Optional profile type" /></label>
          <button className="button-primary inline-flex items-center justify-center gap-2" disabled={!name.trim() || saving} onClick={()=>void addSmartAudience()}><Plus className="h-4 w-4" />{saving ? "Counting…" : "Save smart list"}</button>
        </div>
      </div> : <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-bold">{editingId ? "Edit manual list" : "Create manual list"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick exact profiles instead of using filters. Only profiles with an email address can be added.</p>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">List name<input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Hulk leg prospects" /></label>
          <div className="grid gap-1">
            <span className="text-sm font-semibold">Find profiles</span>
            <div className="flex gap-2"><input value={manualSearch} onChange={(e)=>setManualSearch(e.target.value)} onKeyDown={(event)=>{ if(event.key === "Enter") void searchManualProfiles(); }} placeholder="Search event or city…" /><button className="button-secondary inline-flex items-center gap-2" onClick={()=>void searchManualProfiles()} disabled={searching}><Search className="h-4 w-4" />{searching ? "Searching…" : "Search"}</button></div>
          </div>
          {selectedProfiles.length > 0 ? <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-sm font-bold">Selected · {selectedProfiles.length}</p><div className="mt-2 grid gap-1">{selectedProfiles.map((profile)=><button className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-background" key={profile.id} onClick={()=>toggleManualProfile(profile)}><span><span className="font-semibold">{profile.name}</span><span className="ml-2 text-muted-foreground">{profile.email}</span></span><span className="text-xs text-destructive">Remove</span></button>)}</div></div> : null}
          <button className="button-primary" disabled={!name.trim() || selectedProfiles.length === 0} onClick={saveManualAudience}>{editingId ? `Save changes · ${selectedProfiles.length}` : `Save manual list · ${selectedProfiles.length}`}</button>
          {editingId ? <button className="button-secondary" onClick={resetManualForm}>Cancel editing</button> : null}
        </div>
      </div>}

      <div className="grid content-start gap-3">
        {mode === "manual" && manualResults.length > 0 ? <div className="rounded-xl border border-border bg-card p-4"><h3 className="font-bold">Email-ready profiles</h3><p className="mt-1 text-sm text-muted-foreground">Check the exact profiles you want on this list.</p><div className="mt-3 grid max-h-[360px] gap-2 overflow-y-auto">{manualResults.map((profile)=>{ const selected = selectedProfiles.some((item)=>item.id===profile.id); return <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${selected ? "border-primary bg-primary/5" : "border-border"}`} key={profile.id}><input checked={selected} onChange={()=>toggleManualProfile(profile)} type="checkbox" /><span className="min-w-0"><span className="block font-semibold">{profile.name}</span><span className="block truncate text-sm text-muted-foreground">{profile.email}</span></span></label>; })}</div></div> : null}

        <div className="grid gap-3">
          {state.audiences.length === 0 ? <Empty title="No audiences yet" body="Create a smart list or hand-pick a manual list, then select it when you build an email campaign." /> : state.audiences.map((audience)=><article className="rounded-xl border border-border bg-card p-4" key={audience.id}>
            <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{audience.name}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold uppercase tracking-wide">{audience.kind === "manual" ? "Manual" : "Smart"}</span></div><p className="mt-1 text-sm text-muted-foreground">{audience.kind === "manual" ? `${audience.profileIds.length} selected profiles with email` : `About ${audience.estimatedCount} profiles with email${audience.region ? ` · ${audience.region}` : ""}${audience.q ? ` · “${audience.q}”` : ""}`}</p></div><button aria-label={`Delete ${audience.name}`} className="button-secondary p-2" onClick={()=>setState((current)=>({...current,audiences:current.audiences.filter((item)=>item.id!==audience.id)}))}><Trash2 className="h-4 w-4" /></button></div>
            {audience.kind === "smart" ? <Link className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline" href={audienceHref(audience)}>Open matching profiles →</Link> : <div className="mt-3"><div className="flex flex-wrap gap-2">{audience.profiles.slice(0,5).map((profile)=><Link className="rounded-full border border-border px-2 py-1 text-xs font-semibold hover:border-primary/40" href={`/profiles/${profile.id}`} key={profile.id}>{profile.name}</Link>)}{audience.profiles.length > 5 ? <span className="px-2 py-1 text-xs text-muted-foreground">+{audience.profiles.length - 5} more</span> : null}</div><button className="mt-3 text-sm font-semibold text-primary hover:underline" onClick={()=>editManualAudience(audience)}>Edit members →</button></div>}
          </article>)}
        </div>
      </div>
    </div>
  </section>;
}

function Promos({ state, setState, setNotice }: { state: MarketingState; setState: React.Dispatch<React.SetStateAction<MarketingState>>; setNotice: (value: string | null) => void }) {
  const [title, setTitle] = useState(""); const [kind, setKind] = useState("Brochure"); const [notes, setNotes] = useState("");
  function addPromo() { if (!title.trim()) return; const item: Promo = { id: crypto.randomUUID(), title: title.trim(), kind, notes: notes.trim(), createdAt: new Date().toISOString() }; setState((current)=>({...current,promos:[item,...current.promos]})); setTitle(""); setNotes(""); setNotice(`Saved promo “${item.title}”.`); }
  return <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
    <div className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Add promo material</h2><p className="mt-1 text-sm text-muted-foreground">Track brochures, promo sheets, postcards, and reusable marketing pieces.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-semibold">Title<input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="2027 Adventure Zone brochure" /></label><label className="grid gap-1 text-sm font-semibold">Type<select value={kind} onChange={(e)=>setKind(e.target.value)}><option>Brochure</option><option>Promo sheet</option><option>Postcard</option><option>Flyer</option><option>Other</option></select></label><label className="grid gap-1 text-sm font-semibold">Notes<textarea rows={4} value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="What it is for, where the latest file lives, mailing notes…" /></label><button className="button-primary" disabled={!title.trim()} onClick={addPromo}>Save promo</button><Link className="button-secondary text-center" href="/design-studio">Open Design Studio</Link></div></div>
    <div className="grid content-start gap-3">{state.promos.length===0?<Empty title="No promo materials saved" body="Save the brochures and promo pieces you actually reuse so they are easy to find from campaigns." />:state.promos.map((promo)=><article className="rounded-xl border border-border bg-card p-4" key={promo.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-primary">{promo.kind}</p><h3 className="mt-1 font-bold">{promo.title}</h3>{promo.notes?<p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{promo.notes}</p>:null}</div><button className="button-secondary p-2" onClick={()=>setState((current)=>({...current,promos:current.promos.filter((item)=>item.id!==promo.id)}))}><Trash2 className="h-4 w-4" /></button></div></article>)}</div>
  </section>;
}

function EmailCampaigns({ state, setState, setNotice }: { state: MarketingState; setState: React.Dispatch<React.SetStateAction<MarketingState>>; setNotice: (value: string | null) => void }) {
  const [name,setName]=useState(""); const [subject,setSubject]=useState(""); const [body,setBody]=useState(""); const [audienceId,setAudienceId]=useState("");
  const audience = useMemo(()=>state.audiences.find((item)=>item.id===audienceId) ?? null,[audienceId,state.audiences]);
  function saveCampaign(){ if(!name.trim()||!subject.trim()) return; const item: Campaign={id:crypto.randomUUID(),name:name.trim(),subject:subject.trim(),body:body.trim(),audienceId:audience?.id??null,audienceName:audience?.name??"No audience selected",recipientCount:audience ? audienceRecipientCount(audience) : 0,status:"draft",createdAt:new Date().toISOString(),sentAt:null}; setState((current)=>({...current,campaigns:[item,...current.campaigns]})); setName("");setSubject("");setBody("");setAudienceId("");setNotice(`Saved campaign draft “${item.name}”. Review it before sending.`); }
  return <section className="grid gap-4 lg:grid-cols-[1fr_320px]"><div className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Prepare email campaign</h2><p className="mt-1 text-sm text-muted-foreground">This prepares the campaign record and copy. Sending stays a reviewed action in your connected email workflow rather than a blind mass-send button.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-semibold">Campaign name<input value={name} onChange={(e)=>setName(e.target.value)} placeholder="2027 early booking outreach" /></label><label className="grid gap-1 text-sm font-semibold">Audience<select value={audienceId} onChange={(e)=>setAudienceId(e.target.value)}><option value="">Choose a saved audience</option>{state.audiences.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.kind === "manual" ? "Manual" : "Smart"} · {audienceRecipientCount(item)}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Subject<input value={subject} onChange={(e)=>setSubject(e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Email copy<textarea rows={10} value={body} onChange={(e)=>setBody(e.target.value)} placeholder="Draft the campaign email here…" /></label><button className="button-primary" disabled={!name.trim()||!subject.trim()} onClick={saveCampaign}>Save campaign draft</button></div></div><aside className="grid content-start gap-3"><div className="rounded-xl border border-border bg-card p-4"><h3 className="font-bold">Email workflow</h3><p className="mt-1 text-sm text-muted-foreground">Use the saved campaign as your reviewed source, then create/send the actual messages through the connected Booking email workspace.</p><Link className="button-secondary mt-3 block text-center" href="/office-coordinator">Office Coordinator</Link><Link className="button-secondary mt-2 block text-center" href="/office/emails">Email drafts</Link></div>{state.audiences.length===0?<div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Create an audience first if you want recipient counts and a reusable target list.</div>:null}</aside></section>;
}

function History({ state, setState }: { state: MarketingState; setState: React.Dispatch<React.SetStateAction<MarketingState>> }) {
  return <section className="grid gap-3">{state.campaigns.length===0?<Empty title="No campaign history yet" body="Saved email campaigns will appear here. Mark a reviewed campaign as sent to preserve the date and recipient estimate." />:state.campaigns.map((campaign)=><article className="rounded-xl border border-border bg-card p-4" key={campaign.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{campaign.name}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${campaign.status==="sent"?"bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300":"bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"}`}>{campaign.status}</span></div><p className="mt-1 text-sm text-muted-foreground">{campaign.audienceName} · about {campaign.recipientCount} recipients · created {new Date(campaign.createdAt).toLocaleDateString()}</p><p className="mt-2 text-sm font-semibold">{campaign.subject}</p>{campaign.sentAt?<p className="mt-1 text-xs text-muted-foreground">Sent {new Date(campaign.sentAt).toLocaleString()}</p>:null}</div><div className="flex gap-2">{campaign.status==="draft"?<button className="button-secondary" onClick={()=>setState((current)=>({...current,campaigns:current.campaigns.map((item)=>item.id===campaign.id?{...item,status:"sent",sentAt:new Date().toISOString()}:item)}))}>Mark sent</button>:null}<button className="button-secondary p-2" onClick={()=>setState((current)=>({...current,campaigns:current.campaigns.filter((item)=>item.id!==campaign.id)}))}><Trash2 className="h-4 w-4" /></button></div></div>{campaign.body?<details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-primary">View saved copy</summary><p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{campaign.body}</p></details>:null}</article>)}</section>;
}

function Empty({title,body}:{title:string;body:string}){return <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center"><h3 className="font-bold">{title}</h3><p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{body}</p></div>;}
