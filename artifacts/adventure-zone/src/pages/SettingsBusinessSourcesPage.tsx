import { useEffect, useState } from "react";

import { openSourceDocument, SourceDocumentFileCard, type SourceFileMetadata } from "@/components/business-sources/source-document-file-card";
import { SourceDocumentLinkEditor } from "@/components/business-sources/source-document-link-editor";
import { apiFetch } from "@/lib/auth-token";

type Source = {
  id: string;
  originalFilename: string;
  displayTitle: string;
  sourceCategory: string;
  effectiveYear: number | null;
  accessScope: string;
  reviewState: string;
  hasFile: boolean;
  file: SourceFileMetadata | null;
  notes: string | null;
};
type Conflict = {
  id: string;
  sourceTitle: string;
  factKey: string;
  proposedValue: string;
  normalizedValue: string | null;
  sourceLocator: string;
  conflictGroup: string | null;
};

function fileSizeLabel(file: SourceFileMetadata | null) {
  if (!file) return null;
  return `${Math.max(1, Math.round(file.originalSizeBytes / 1024))} KB`;
}

export default function SettingsBusinessSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [sourceResponse, conflictResponse] = await Promise.all([
      apiFetch("/business-sources"),
      apiFetch("/business-sources/conflicts"),
    ]);
    if (!sourceResponse.ok || !conflictResponse.ok) throw new Error("Could not load business source reviews.");
    const sourceData = (await sourceResponse.json()) as { sources: Source[] };
    const conflictData = (await conflictResponse.json()) as { conflicts: Conflict[] };
    setSources(sourceData.sources);
    setConflicts(conflictData.conflicts);
  }

  useEffect(() => { load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load business sources.")); }, []);

  async function openFile(source: Source) {
    if (!source.hasFile || !source.file || busyId === source.id) return;
    setBusyId(source.id);
    setError("");
    try {
      await openSourceDocument(source.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the source document.");
    } finally {
      setBusyId(null);
    }
  }

  async function decide(conflict: Conflict, reviewState: "approved" | "rejected") {
    setBusyId(conflict.id); setError("");
    try {
      const response = await apiFetch(`/business-sources/facts/${conflict.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reviewState, normalizedValue: conflict.normalizedValue ?? conflict.proposedValue }),
      });
      if (!response.ok) throw new Error("Could not save the source decision.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the source decision.");
    } finally { setBusyId(null); }
  }

  return <div className="mx-auto grid max-w-7xl gap-6 py-6">
    <header><h1 className="text-3xl font-bold">Business sources</h1><p className="mt-1 text-slate-600">Original company files are evidence. Reviewed app facts and polished customer wording stay separate from raw source material.</p></header>
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 font-semibold text-rose-700">{error}</p> : null}
    <section className="grid gap-3"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Source library</h2><span className="text-sm text-slate-500">{sources.length} files</span></div>{sources.map((source) => <article className="grid gap-3 rounded-xl border bg-white p-4" key={source.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-bold">{source.displayTitle}</h3><p className="break-all text-sm text-slate-500">{source.originalFilename}</p>{source.hasFile && source.file ? <p className="mt-1 text-xs font-semibold text-emerald-700">Uploaded · {fileSizeLabel(source.file)}</p> : null}</div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{source.reviewState}</span>{source.hasFile?<span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">file stored</span>:null}{source.hasFile && source.file ? <button className="button-secondary" disabled={busyId === source.id} onClick={() => void openFile(source)} type="button">View file</button> : null}</div></div><p className="text-sm text-slate-700">{source.notes}</p><p className="text-xs text-slate-500">{source.sourceCategory}{source.effectiveYear ? ` · ${source.effectiveYear}` : ""} · {source.accessScope}</p><details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">File, links &amp; historical terms</summary><div className="mt-3 grid gap-3"><SourceDocumentFileCard documentId={source.id} file={source.file} onChanged={load}/><SourceDocumentLinkEditor documentId={source.id}/></div></details></article>)}</section>
    <section className="grid gap-3"><div><h2 className="text-xl font-bold">Needs confirmation</h2><p className="text-sm text-slate-600">Conflicting source values stay here until you decide which one becomes operational truth.</p></div>{conflicts.length ? conflicts.map((conflict) => <article className="rounded-xl border border-amber-200 bg-amber-50 p-4" key={conflict.id}><p className="text-xs font-bold uppercase tracking-wide text-amber-800">{conflict.conflictGroup ?? conflict.factKey}</p><h3 className="mt-1 font-bold">{conflict.proposedValue}</h3><p className="mt-1 text-sm text-amber-950">Source: {conflict.sourceTitle} · {conflict.sourceLocator}</p><div className="mt-3 flex flex-wrap gap-2"><button className="button-primary" disabled={busyId === conflict.id} type="button" onClick={() => void decide(conflict, "approved")}>Use this value</button><button className="button-secondary" disabled={busyId === conflict.id} type="button" onClick={() => void decide(conflict, "rejected")}>Reject this value</button></div></article>) : <div className="rounded-xl border bg-white p-5 text-slate-600">No unresolved source conflicts.</div>}</section>
  </div>;
}
