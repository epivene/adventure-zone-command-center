import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Link } from "wouter";
import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";

type CrmMatch =
  | { status: "existing"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "possible_match"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "new_prospect" };

type ScoutEvent = {
  name: string;
  city: string | null;
  region: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  url: string;
  rationale: string;
  crmMatch?: CrmMatch;
};

type SavedSource = {
  id: string;
  url: string;
  title: string;
  notes: string | null;
  archivedAt: string | null;
  lastScoutedAt: string | null;
  lastScoutStartDate: string | null;
  lastScoutEndDate: string | null;
  lastScoutResults: ScoutEvent[];
};

function dateInput(value: Date) {
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function defaultWindow(source: SavedSource) {
  const start = source.lastScoutEndDate
    ? new Date(`${source.lastScoutEndDate}T12:00:00`)
    : new Date();
  if (source.lastScoutEndDate) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 6);
  return { start: dateInput(start), end: dateInput(end) };
}

function eventHref(event: ScoutEvent) {
  if (event.crmMatch?.status === "existing" || event.crmMatch?.status === "possible_match") {
    return event.crmMatch.bookingId ? `/bookings/${event.crmMatch.bookingId}` : `/profiles/${event.crmMatch.organizationId}`;
  }
  const params = new URLSearchParams({
    source: "scout",
    name: event.name,
    city: event.city ?? "",
    region: event.region ?? "",
    sourceUrl: event.url,
    startsAt: event.startsAt ?? "",
    endsAt: event.endsAt ?? "",
  });
  return `/event-profiles/new?${params.toString()}`;
}

function eventAction(event: ScoutEvent) {
  if (event.crmMatch?.status === "existing") return "Open profile";
  if (event.crmMatch?.status === "possible_match") return "Review match";
  return "Add as lead";
}

export default function ResearchSourcesPage() {
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [activeScout, setActiveScout] = useState<string | null>(null);
  const [scoutFrom, setScoutFrom] = useState("");
  const [scoutThrough, setScoutThrough] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await apiGet<{ sources: SavedSource[] }>("/research-sources");
      setSources(response.sources ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load research sources.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function addSource() {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost("/research-sources", { url: url.trim(), title: title.trim() || undefined });
      setUrl(""); setTitle("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that source.");
    } finally { setBusy(false); }
  }

  function openScout(source: SavedSource) {
    const window = defaultWindow(source);
    setActiveScout(source.id);
    setScoutFrom(window.start);
    setScoutThrough(window.end);
  }

  async function scout(source: SavedSource) {
    if (!scoutFrom || !scoutThrough || busy) return;
    setBusy(true);
    try {
      const response = await apiPost<{ source: SavedSource }>(`/research-sources/${source.id}/scout`, {
        startDate: scoutFrom,
        endDate: scoutThrough,
      });
      setSources((current) => current.map((item) => item.id === source.id ? response.source : item));
      setActiveScout(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not scout that source.");
    } finally { setBusy(false); }
  }

  async function archive(source: SavedSource) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/research-sources/${source.id}/archive`, {});
      setSources((current) => current.filter((item) => item.id !== source.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive that source.");
    } finally { setBusy(false); }
  }

  const totals = useMemo(() => sources.reduce((acc, source) => {
    for (const event of source.lastScoutResults) {
      const key = event.crmMatch?.status ?? "new_prospect";
      acc[key] = (acc[key] ?? 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>), [sources]);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Researcher</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Research Sources</h1>
        <p className="mt-2 max-w-3xl text-slate-600">Keep useful tourism calendars, fair directories, city event pages, and other prospecting sources so you can scout them again without rediscovering them from a profile.</p>
      </header>

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1 text-sm font-semibold">Source URL<input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" placeholder="https://..." value={url} onChange={(event) => setUrl(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Label <span className="text-xs font-normal text-slate-500">optional</span><input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" placeholder="Breckenridge events calendar" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <button className="button-primary self-end" disabled={busy || !url.trim()} type="button" onClick={() => void addSource()}>Save source</button>
      </section>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}

      {!loading && sources.length ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">{sources.length} saved source{sources.length === 1 ? "" : "s"}</span>
          <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-800">{totals.new_prospect ?? 0} new prospects in latest scouts</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">{totals.possible_match ?? 0} possible matches</span>
        </div>
      ) : null}

      {loading ? <p className="text-slate-500">Loading saved sources…</p> : sources.length ? (
        <div className="grid gap-4">
          {sources.map((source) => {
            const newCount = source.lastScoutResults.filter((event) => (event.crmMatch?.status ?? "new_prospect") === "new_prospect").length;
            const possibleCount = source.lastScoutResults.filter((event) => event.crmMatch?.status === "possible_match").length;
            const existingCount = source.lastScoutResults.filter((event) => event.crmMatch?.status === "existing").length;
            return (
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={source.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">{source.title}</h2>
                    <a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-sm text-orange-700 hover:underline" href={source.url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4 shrink-0" />{source.url}</a>
                    <p className="mt-2 text-sm text-slate-600">{source.lastScoutedAt ? `Last scouted ${new Date(source.lastScoutedAt).toLocaleDateString()} · ${source.lastScoutStartDate}–${source.lastScoutEndDate}` : "Never scouted from the library"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="button-primary" type="button" onClick={() => openScout(source)}><Search className="mr-1 inline h-4 w-4" />Scout again</button>
                    <button className="button-secondary" disabled={busy} type="button" onClick={() => void archive(source)}>Archive</button>
                  </div>
                </div>

                {source.lastScoutedAt ? <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-800">{newCount} new</span><span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">{possibleCount} possible</span><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">{existingCount} existing</span></div> : null}

                {activeScout === source.id ? (
                  <div className="mt-4 grid gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-semibold">Scout from<input className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" type="date" value={scoutFrom} onChange={(event) => setScoutFrom(event.target.value)} /></label>
                    <label className="grid gap-1 text-sm font-semibold">Scout through<input className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" type="date" value={scoutThrough} onChange={(event) => setScoutThrough(event.target.value)} /></label>
                    <div className="flex gap-2 sm:col-span-2"><button className="button-primary" disabled={busy || !scoutFrom || !scoutThrough} type="button" onClick={() => void scout(source)}>{busy ? "Scouting…" : "Run scout"}</button><button className="button-secondary" type="button" onClick={() => setActiveScout(null)}>Cancel</button></div>
                  </div>
                ) : null}

                {source.lastScoutResults.length ? (
                  <details className="mt-4 rounded-lg bg-slate-50 p-3">
                    <summary className="cursor-pointer font-semibold">Latest scout results ({source.lastScoutResults.length})</summary>
                    <div className="mt-3 grid gap-2">
                      {source.lastScoutResults.map((event, index) => (
                        <div className="rounded-lg bg-white p-3" key={`${event.name}-${event.startsAt ?? index}`}>
                          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{event.name}</p><p className="text-xs text-slate-600">{[event.startsAt, [event.city, event.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "Details not confirmed"}</p></div><Link className="text-xs font-semibold text-orange-700 hover:underline" href={eventHref(event)}>{eventAction(event)}</Link></div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">No research sources saved yet. Save a useful public events page here or from Profile Research.</div>}
    </div>
  );
}
