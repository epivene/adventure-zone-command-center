import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPenLine, MailCheck, Plus, RefreshCw, X } from "lucide-react";
import { apiFetch } from "@/lib/auth-token";
import { OwnerConventionReview } from "@/components/boss-work-requests/OwnerConventionReview";
import type { BossWorkRequest, BossWorkRequestDetail } from "@/features/boss-work-requests/boss-work-request-types";
import {
  createOwnerWorkRequest,
  getBossAccounts,
  getOwnerWorkQueue,
  getOwnerWorkRequest,
  returnWorkRequest,
  type OwnerWorkQueue,
} from "@/features/boss-work-requests/owner-boss-work-request-api";

type Tab = keyof OwnerWorkQueue;
const tabs: { id: Tab; label: string }[] = [
  { id: "needsDave", label: "Needs Dave" },
  { id: "submittedToMe", label: "Submitted to Me" },
  { id: "changesRequested", label: "Changes Requested" },
  { id: "completed", label: "Completed" },
];

export default function DaveRequestsPage() {
  const [queue, setQueue] = useState<OwnerWorkQueue | null>(null);
  const [tab, setTab] = useState<Tab>("needsDave");
  const [selected, setSelected] = useState<BossWorkRequestDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [bosses, setBosses] = useState<{ id: string; displayName: string; enabled: boolean }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; state: string }[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setQueue(await getOwnerWorkQueue());
      if (selected) setSelected(await getOwnerWorkRequest(selected.request.id));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Dave Requests."); }
  }, [selected?.request.id]);
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    getBossAccounts().then((result) => setBosses(result.accounts.filter((item) => item.enabled))).catch(() => undefined);
    apiFetch("/communication-templates").then((response) => response.json()).then((result) => setTemplates(result.templates ?? [])).catch(() => undefined);
  }, []);

  const items = useMemo(() => queue?.[tab] ?? [], [queue, tab]);

  async function open(request: BossWorkRequest) {
    try { setSelected(await getOwnerWorkRequest(request.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open request."); }
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-primary">Owner Workspace</p><h1 className="text-2xl font-bold">Dave Requests</h1><p className="text-sm text-muted-foreground">Give Dave forms or email previews, then review what comes back.</p></div>
        <div className="flex gap-2">
          <button onClick={() => void reload()} className="min-h-11 rounded-lg border px-3"><RefreshCw className="h-4 w-4" /></button>
          <button onClick={() => setShowCreate(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 font-bold text-primary-foreground"><Plus className="h-4 w-4" /> New Request</button>
        </div>
      </header>
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <nav className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${tab === item.id ? "bg-primary text-primary-foreground" : "border bg-card"}`}>{item.label} ({queue?.[item.id].length ?? 0})</button>)}
      </nav>
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="grid content-start gap-2">
          {items.length === 0 && <p className="rounded-xl border bg-card p-5 text-center text-sm text-muted-foreground">Nothing in this section.</p>}
          {items.map((request) => {
            const Icon = request.type === "rapid_convention_notes" ? ClipboardPenLine : MailCheck;
            return <button key={request.id} onClick={() => void open(request)} className={`flex gap-3 rounded-xl border bg-card p-4 text-left ${selected?.request.id === request.id ? "border-primary ring-1 ring-primary" : ""}`}>
              <Icon className="mt-0.5 h-5 w-5 text-primary" /><span><span className="block font-bold">{request.title}</span><span className="text-xs text-muted-foreground">{request.priority} · {request.state.replaceAll("_", " ")}</span></span>
            </button>;
          })}
        </section>
        <section className="min-h-64 rounded-xl border bg-card p-4 sm:p-6">
          {!selected ? <p className="text-center text-muted-foreground">Choose a request to review it.</p> : (
            <div className="grid gap-4">
              <div><h2 className="text-xl font-bold">{selected.request.title}</h2><p className="text-sm text-muted-foreground">{selected.request.instructions}</p></div>
              {selected.request.type === "rapid_convention_notes" ? (
                <div className="grid gap-3">
                  {selected.submissions.length === 0 && <p className="rounded-lg bg-muted p-4 text-sm">Dave has not submitted notes yet.</p>}
                  {selected.submissions.map((submission) => <OwnerConventionReview key={submission.id} requestId={selected.request.id} submission={submission} reload={reload} />)}
                  {selected.request.state === "submitted_to_owner" && <button onClick={async () => { const note = window.prompt("What does Dave need to clarify?"); if (note) { await returnWorkRequest(selected.request.id, note); await reload(); } }} className="min-h-11 rounded-lg border px-4 font-semibold">Return for Clarification</button>}
                </div>
              ) : selected.templateReview ? (
                <div className="grid gap-3">
                  <p className="text-sm"><strong>Decision:</strong> {selected.templateReview.decision.replaceAll("_", " ")}</p>
                  {selected.templateReview.note && <p className="rounded-lg bg-muted p-3 text-sm">{selected.templateReview.note}</p>}
                  <div className="overflow-hidden rounded-lg border bg-white">
                    {selected.templateReview.bodyFormatSnapshot === "html"
                      ? <iframe title="Reviewed email" sandbox="" srcDoc={selected.templateReview.bodySnapshot} className="min-h-[30rem] w-full" />
                      : <pre className="whitespace-pre-wrap p-4 font-sans text-sm text-slate-900">{selected.templateReview.bodySnapshot}</pre>}
                  </div>
                </div>
              ) : <p>Template review is unavailable.</p>}
            </div>
          )}
        </section>
      </div>
      {showCreate && <CreateRequestDialog bosses={bosses} templates={templates} close={() => setShowCreate(false)} created={async () => { setShowCreate(false); await reload(); }} />}
    </main>
  );
}

function CreateRequestDialog({ bosses, templates, close, created }: {
  bosses: { id: string; displayName: string }[]; templates: { id: string; name: string; state: string }[]; close: () => void; created: () => Promise<void>;
}) {
  const [type, setType] = useState<"rapid_convention_notes" | "email_template_approval">("rapid_convention_notes");
  const [assignedBossAccountId, setBoss] = useState(bosses[0]?.id ?? "");
  const [title, setTitle] = useState("Rapid Convention Notes");
  const [instructions, setInstructions] = useState("Use this while you are talking to people. Save each conversation, then start the next one.");
  const [priority, setPriority] = useState<"normal" | "high" | "urgent">("normal");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    try {
      await createOwnerWorkRequest({ type, assignedBossAccountId, title, instructions, priority, ...(type === "email_template_approval" ? { templateId } : {}) });
      await created();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create request."); }
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
    <div className="w-full max-w-lg rounded-2xl bg-background p-5 shadow-xl">
      <div className="flex justify-between"><h2 className="text-xl font-bold">New Request for Dave</h2><button onClick={close}><X /></button></div>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm font-semibold">Request type<select className="min-h-11 rounded-lg border bg-background px-3" value={type} onChange={(e) => { const next=e.target.value as typeof type; setType(next); setTitle(next === "rapid_convention_notes" ? "Rapid Convention Notes" : "Review Email Template"); }}><option value="rapid_convention_notes">Rapid Convention Notes</option><option value="email_template_approval">Email Template Approval</option></select></label>
        <label className="grid gap-1 text-sm font-semibold">For<select className="min-h-11 rounded-lg border bg-background px-3" value={assignedBossAccountId} onChange={(e) => setBoss(e.target.value)}><option value="">Choose Dave’s account…</option>{bosses.map((boss) => <option key={boss.id} value={boss.id}>{boss.displayName}</option>)}</select></label>
        {type === "email_template_approval" && <label className="grid gap-1 text-sm font-semibold">Template<select className="min-h-11 rounded-lg border bg-background px-3" value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">Choose template…</option>{templates.filter((t) => t.state !== "active").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <label className="grid gap-1 text-sm font-semibold">Title<input className="min-h-11 rounded-lg border bg-background px-3" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Instructions<textarea rows={3} className="rounded-lg border bg-background p-3" value={instructions} onChange={(e) => setInstructions(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Priority<select className="min-h-11 rounded-lg border bg-background px-3" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        <button onClick={() => void submit()} className="min-h-12 rounded-xl bg-primary font-bold text-primary-foreground">Send to Dave</button>
      </div>
    </div>
  </div>;
}
