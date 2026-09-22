import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { EventDateStatusBadge } from "@/features/event-date-coverage/event-date-status-badge";
import {
  eventDateCoverageKeys, getCoverageProfile, getCoverageProfiles, getCoverageRun,
  retryCoverageItem, reviewCoverageFact, startCoverageRun, type EventDateCoverageStatus,
} from "@/features/event-date-coverage/event-date-coverage-api";

const filters: Array<["all" | EventDateCoverageStatus, string]> = [
  ["all", "All"], ["booked", "Booked"], ["confirmed", "Confirmed"], ["expected", "Expected"],
  ["needs_review", "Needs review"], ["missing", "Date not found"], ["stale", "Stale"],
];

export default function EventDateCoveragePage() {
  const searchString = useSearch(); const [, navigate] = useLocation(); const queryClient = useQueryClient();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const status = (params.get("status") ?? "all") as "all" | EventDateCoverageStatus;
  const search = params.get("search") ?? "";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const coverage = useQuery({ queryKey: eventDateCoverageKeys.profiles(params.toString()), queryFn: () => getCoverageProfiles({ search, status }) });
  const detail = useQuery({ queryKey: ["event-date-coverage", "detail", detailId], queryFn: () => getCoverageProfile(detailId!), enabled: Boolean(detailId) });
  const run = useQuery({ queryKey: eventDateCoverageKeys.run(runId ?? ""), queryFn: () => getCoverageRun(runId!), enabled: Boolean(runId), refetchInterval: (query) => ["queued", "researching"].includes(query.state.data?.status ?? "") ? 2_000 : false });
  const start = useMutation({ mutationFn: startCoverageRun, onSuccess: (value) => { setRunId(value.id); setSelected(new Set()); } });
  const refresh = () => queryClient.invalidateQueries({ queryKey: eventDateCoverageKeys.all });
  useEffect(() => {
    if (run.data?.status === "complete") void refresh();
  }, [run.data?.status]);
  const setFilter = (next: string, value: string) => { const copy = new URLSearchParams(params); value ? copy.set(next, value) : copy.delete(next); navigate(`/settings/event-date-coverage?${copy}`); };
  const summary = coverage.data?.summary;
  return <div className="mx-auto max-w-7xl space-y-6 pb-12">
    <header><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Admin Tools</p><h1 className="mt-1 text-3xl font-bold">Event Date Coverage</h1><p className="mt-2 text-muted-foreground">Find the next responsible date for every event profile without turning research into a booking.</p></header>
    <section aria-label="Coverage totals" className="grid grid-cols-2 gap-3 md:grid-cols-6">{filters.slice(1).map(([key, label]) => <button className="rounded-xl border bg-card p-3 text-left" key={key} onClick={() => setFilter("status", key)} type="button"><span className="text-xs font-bold text-muted-foreground">{label}</span><strong className="block text-2xl">{key === "all" ? 0 : summary?.[key] ?? 0}</strong></button>)}</section>
    <section className="rounded-xl border bg-card p-4"><div className="flex flex-wrap gap-3"><input aria-label="Search profiles" className="min-w-56 flex-1" defaultValue={search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Search profiles"/><select aria-label="Date status" onChange={(event) => setFilter("status", event.target.value === "all" ? "" : event.target.value)} value={status}>{filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button-primary" disabled={start.isPending} onClick={() => start.mutate(selected.size ? { organizationIds: [...selected], batchSize: Math.max(25, selected.size) } : { batchSize: 25 })} type="button">{selected.size ? `Research selected (${selected.size})` : "Research next 25"}</button></div>
      {run.data ? <p className="mt-3 text-sm" role="status">Run {run.data.status}: {run.data.items?.filter((item) => !["queued", "researching"].includes(item.status)).length ?? 0}/{run.data.items?.length ?? 0} complete</p> : null}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Select</th><th>Profile</th><th>Location</th><th>Next date</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{coverage.data?.records.map((row) => <tr className="border-t" key={row.organizationId}><td><input aria-label={`Select ${row.name}`} checked={selected.has(row.organizationId)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(row.organizationId) ? next.delete(row.organizationId) : next.add(row.organizationId); return next; })} type="checkbox"/></td><td className="py-3 font-semibold">{row.name}</td><td>{[row.city, row.region].filter(Boolean).join(", ") || "—"}</td><td>{row.effectiveDate?.startsOn ?? "—"}</td><td><EventDateStatusBadge status={row.status}/></td><td><button className="underline" onClick={() => setDetailId(row.organizationId)} type="button">View evidence</button></td></tr>)}</tbody></table></div>
    </section>
    {detailId ? <aside aria-label="Evidence details" className="rounded-xl border bg-card p-4"><div className="flex justify-between"><h2 className="text-xl font-bold">Evidence &amp; sources</h2><button onClick={() => setDetailId(null)} type="button">Close</button></div>{detail.data?.facts.length ? detail.data.facts.map((fact) => <article className="mt-3 border-t pt-3" key={fact.id}><p>{fact.rationale}</p>{fact.sourceUrl ? <a className="underline" href={fact.sourceUrl} rel="noreferrer" target="_blank">{fact.sourceTitle}</a> : <p className="text-sm text-muted-foreground">{fact.sourceRecordType}: {fact.sourceRecordId}</p>}<div className="mt-2 flex gap-2"><button onClick={() => reviewCoverageFact(fact.id, "approve_confirmed").then(refresh)} type="button">Approve confirmed</button><button onClick={() => reviewCoverageFact(fact.id, "approve_expected").then(refresh)} type="button">Approve expected</button><button onClick={() => reviewCoverageFact(fact.id, "dismiss").then(refresh)} type="button">Dismiss</button></div></article>) : <p className="mt-3">No saved evidence yet.</p>}</aside> : null}
    {run.data?.items?.filter((item) => item.status === "failed").map((item) => <button key={item.id} onClick={() => retryCoverageItem(item.id).then(() => run.refetch())} type="button">Retry failed profile</button>)}
  </div>;
}
