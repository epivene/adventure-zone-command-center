import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Mail, Megaphone, Plus, Trash2, UsersRound } from "lucide-react";
import { Link, useSearch } from "wouter";

import { apiGet } from "@/lib/auth-token";

type Area = "email" | "promos" | "audiences" | "history";
type Audience = { id: string; name: string; q: string; region: string; placeType: string; estimatedCount: number; createdAt: string };
type Promo = { id: string; title: string; kind: string; notes: string; createdAt: string };
type Campaign = { id: string; name: string; subject: string; body: string; audienceId: string | null; audienceName: string; recipientCount: number; status: "draft" | "sent"; createdAt: string; sentAt: string | null };
type MarketingState = { audiences: Audience[]; promos: Promo[]; campaigns: Campaign[] };

type OrganizationListPage = { total: number };

const STORAGE_KEY = "adventure-zone-marketing-campaigns-v1";
const emptyState: MarketingState = { audiences: [], promos: [], campaigns: [] };

function readState(): MarketingState {
  if (typeof window === "undefined") return emptyState;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && Array.isArray(parsed.audiences) && Array.isArray(parsed.promos) && Array.isArray(parsed.campaigns) ? parsed : emptyState;
  } catch {
    return emptyState;
  }
}

function areaFromSearch(search: string): Area {
  const value = new URLSearchParams(search).get("area");
  return value === "promos" || value === "audiences" || value === "history" ? value : "email";
}

function audienceHref(audience: Audience) {
  const params = new URLSearchParams();
  if (audience.q) params.set("q", audience.q);
  if (audience.region) params.set("region", audience.region);
  if (audience.placeType) params.set("type", audience.placeType);
  params.set("hasEmail", "yes");
  return `/profiles?${params.toString()}`;
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
          <Link className={`flex items-center gap-2 rounded-xl border p-3 font-semibold transition-colors ${area === key ? "border-primary bg-primary/5 text-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`} href={`/marketing/campaigns?area=${key}`} key={key}>
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
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [placeType, setPlaceType] = useState("");
  const [saving, setSaving] = useState(false);

  async function addAudience() {
    if (!name.trim() || saving) return;
    setSaving(true);
    const params = new URLSearchParams({ hasEmail: "yes", pageSize: "1" });
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (placeType.trim()) params.set("type", placeType.trim());
    let estimatedCount = 0;
    try { estimatedCount = (await apiGet<OrganizationListPage>(`/organizations?${params.toString()}`)).total ?? 0; } catch { estimatedCount = 0; }
    const item: Audience = { id: crypto.randomUUID(), name: name.trim(), q: q.trim(), region: region.trim(), placeType: placeType.trim(), estimatedCount, createdAt: new Date().toISOString() };
    setState((current) => ({ ...current, audiences: [item, ...current.audiences] }));
    setName(""); setQ(""); setRegion(""); setPlaceType(""); setSaving(false); setNotice(`Saved audience “${item.name}” with about ${estimatedCount} email-ready profiles.`);
  }

  return <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-lg font-bold">Create audience</h2>
      <p className="mt-1 text-sm text-muted-foreground">Saved lists use the same profile filters as Booking. Email-ready profiles are counted automatically.</p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm font-semibold">List name<input value={name} onChange={(e)=>setName(e.target.value)} placeholder="2027 county fairs" /></label>
        <label className="grid gap-1 text-sm font-semibold">Search words<input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="fair, festival…" /></label>
        <label className="grid gap-1 text-sm font-semibold">Region<input value={region} onChange={(e)=>setRegion(e.target.value)} placeholder="UT, ND, OR…" /></label>
        <label className="grid gap-1 text-sm font-semibold">Profile type<input value={placeType} onChange={(e)=>setPlaceType(e.target.value)} placeholder="Optional profile type" /></label>
        <button className="button-primary inline-flex items-center justify-center gap-2" disabled={!name.trim() || saving} onClick={()=>void addAudience()}><Plus className="h-4 w-4" />{saving ? "Counting…" : "Save audience"}</button>
      </div>
    </div>
    <div className="grid content-start gap-3">
      {state.audiences.length === 0 ? <Empty title="No audiences yet" body="Create a reusable list here, then select it when you build an email campaign." /> : state.audiences.map((audience)=><article className="rounded-xl border border-border bg-card p-4" key={audience.id}>
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{audience.name}</h3><p className="mt-1 text-sm text-muted-foreground">About {audience.estimatedCount} profiles with email{audience.region ? ` · ${audience.region}` : ""}{audience.q ? ` · “${audience.q}”` : ""}</p></div><button aria-label={`Delete ${audience.name}`} className="button-secondary p-2" onClick={()=>setState((current)=>({...current,audiences:current.audiences.filter((item)=>item.id!==audience.id)}))}><Trash2 className="h-4 w-4" /></button></div>
        <Link className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline" href={audienceHref(audience)}>Open matching profiles →</Link>
      </article>)}
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
  function saveCampaign(){ if(!name.trim()||!subject.trim()) return; const item: Campaign={id:crypto.randomUUID(),name:name.trim(),subject:subject.trim(),body:body.trim(),audienceId:audience?.id??null,audienceName:audience?.name??"No audience selected",recipientCount:audience?.estimatedCount??0,status:"draft",createdAt:new Date().toISOString(),sentAt:null}; setState((current)=>({...current,campaigns:[item,...current.campaigns]})); setName("");setSubject("");setBody("");setAudienceId("");setNotice(`Saved campaign draft “${item.name}”. Review it before sending.`); }
  return <section className="grid gap-4 lg:grid-cols-[1fr_320px]"><div className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Prepare email campaign</h2><p className="mt-1 text-sm text-muted-foreground">This prepares the campaign record and copy. Sending stays a reviewed action in your connected email workflow rather than a blind mass-send button.</p><div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-semibold">Campaign name<input value={name} onChange={(e)=>setName(e.target.value)} placeholder="2027 early booking outreach" /></label><label className="grid gap-1 text-sm font-semibold">Audience<select value={audienceId} onChange={(e)=>setAudienceId(e.target.value)}><option value="">Choose a saved audience</option>{state.audiences.map((item)=><option key={item.id} value={item.id}>{item.name} · ~{item.estimatedCount}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Subject<input value={subject} onChange={(e)=>setSubject(e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Email copy<textarea rows={10} value={body} onChange={(e)=>setBody(e.target.value)} placeholder="Draft the campaign email here…" /></label><button className="button-primary" disabled={!name.trim()||!subject.trim()} onClick={saveCampaign}>Save campaign draft</button></div></div><aside className="grid content-start gap-3"><div className="rounded-xl border border-border bg-card p-4"><h3 className="font-bold">Email workflow</h3><p className="mt-1 text-sm text-muted-foreground">Use the saved campaign as your reviewed source, then create/send the actual messages through the connected Booking email workspace.</p><Link className="button-secondary mt-3 block text-center" href="/office-coordinator">Office Coordinator</Link><Link className="button-secondary mt-2 block text-center" href="/office/emails">Email drafts</Link></div>{state.audiences.length===0?<div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Create an audience first if you want recipient counts and a reusable target list.</div>:null}</aside></section>;
}

function History({ state, setState }: { state: MarketingState; setState: React.Dispatch<React.SetStateAction<MarketingState>> }) {
  return <section className="grid gap-3">{state.campaigns.length===0?<Empty title="No campaign history yet" body="Saved email campaigns will appear here. Mark a reviewed campaign as sent to preserve the date and recipient estimate." />:state.campaigns.map((campaign)=><article className="rounded-xl border border-border bg-card p-4" key={campaign.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{campaign.name}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${campaign.status==="sent"?"bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300":"bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"}`}>{campaign.status}</span></div><p className="mt-1 text-sm text-muted-foreground">{campaign.audienceName} · about {campaign.recipientCount} recipients · created {new Date(campaign.createdAt).toLocaleDateString()}</p><p className="mt-2 text-sm font-semibold">{campaign.subject}</p>{campaign.sentAt?<p className="mt-1 text-xs text-muted-foreground">Sent {new Date(campaign.sentAt).toLocaleString()}</p>:null}</div><div className="flex gap-2">{campaign.status==="draft"?<button className="button-secondary" onClick={()=>setState((current)=>({...current,campaigns:current.campaigns.map((item)=>item.id===campaign.id?{...item,status:"sent",sentAt:new Date().toISOString()}:item)}))}>Mark sent</button>:null}<button className="button-secondary p-2" onClick={()=>setState((current)=>({...current,campaigns:current.campaigns.filter((item)=>item.id!==campaign.id)}))}><Trash2 className="h-4 w-4" /></button></div></div>{campaign.body?<details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-primary">View saved copy</summary><p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{campaign.body}</p></details>:null}</article>)}</section>;
}

function Empty({title,body}:{title:string;body:string}){return <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center"><h3 className="font-bold">{title}</h3><p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{body}</p></div>;}
